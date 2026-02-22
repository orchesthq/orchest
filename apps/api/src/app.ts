import express from "express";
import { z, ZodError } from "zod";
import { agentRoutes } from "./routes/agentRoutes";
import { taskRoutes } from "./routes/taskRoutes";
import { clientRoutes } from "./routes/clientRoutes";
import { slackInternalRoutes } from "./routes/slackInternalRoutes";
import { githubInternalRoutes } from "./routes/githubInternalRoutes";
import { slackEventsHandler, slackPublicRoutes } from "./routes/slackPublicRoutes";
import { DbNotConfiguredError, isDbConfigured } from "./db/client";
import { InternalAuthNotConfiguredError, requireInternalServiceAuth } from "./middleware/internalAuth";

export function createApp() {
  const app = express();

  // Slack Events API requires raw body for signature verification.
  app.post("/integrations/slack/events", express.raw({ type: "application/json" }), slackEventsHandler);

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));

  app.get("/health", async (_req, res) => {
    res.status(200).json({ ok: true, dbConfigured: isDbConfigured() });
  });

  // Integrations
  app.use("/integrations/slack", slackPublicRoutes);

  // Internal endpoints used by the dashboard server (requires shared secret).
  app.use("/internal/clients", requireInternalServiceAuth, clientRoutes);
  app.use("/internal/slack", requireInternalServiceAuth, requireClientId, slackInternalRoutes);
  app.use("/internal/github", requireInternalServiceAuth, requireClientId, githubInternalRoutes);

  // API (requires a client context)
  app.use("/agents", requireClientId, agentRoutes);
  app.use("/tasks", requireClientId, taskRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

function requireClientId(req: express.Request, res: express.Response, next: express.NextFunction) {
  const raw = req.header("x-client-id");
  const parsed = z.string().uuid().safeParse(raw);
  if (!parsed.success) {
    res.status(400).json({
      error:
        "Missing or invalid x-client-id header (must be a UUID). For Slack, client is resolved via installation mapping.",
    });
    return;
  }

  req.clientId = parsed.data;
  next();
}

function notFoundHandler(_req: express.Request, res: express.Response) {
  res.status(404).json({ error: "Not found" });
}

function errorHandler(err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Invalid request", issues: err.issues });
    return;
  }

  if (err instanceof DbNotConfiguredError) {
    res.status(503).json({
      error: "Database is not configured. Set DATABASE_URL and apply migrations to enable persistence.",
    });
    return;
  }

  if (err instanceof InternalAuthNotConfiguredError) {
    res.status(503).json({
      error:
        "Internal auth is not configured. Set INTERNAL_SERVICE_SECRET to enable dashboard onboarding calls.",
    });
    return;
  }

  console.error("[http] unhandled error", err);
  res.status(500).json({ error: "Internal server error" });
}

