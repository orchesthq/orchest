import express from "express";
import { z } from "zod";
import {
  getGitHubInstallUrl,
  getGitHubStatus,
  listAgentGitHubConnections,
  linkAgentToGitHub,
  handleGitHubInstallationCallback,
  listInstallationRepos,
} from "../integrations/github/githubService";
import {
  deleteGitHubAgentConnectionByIdScoped,
  deleteGitHubAgentConnectionScoped,
  deleteGitHubInstallationByClientId,
} from "../db/schema";

const router = express.Router();

router.post("/complete-installation", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const body = z
      .object({
        installationId: z.number().int().positive(),
      })
      .parse(req.body ?? {});

    const installation = await handleGitHubInstallationCallback({
      clientId,
      installationId: body.installationId,
    });

    res.status(200).json({ installation });
  } catch (err) {
    next(err);
  }
});

router.get("/repos", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const repos = await listInstallationRepos(clientId);
    res.status(200).json({ repos });
  } catch (err) {
    next(err);
  }
});

router.get("/status", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const status = await getGitHubStatus(clientId);
    res.status(200).json(status);
  } catch (err) {
    next(err);
  }
});

router.get("/install-url", async (req, res, next) => {
  try {
    const url = await getGitHubInstallUrl();
    res.status(200).json({ url });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "GitHubConfigError") {
      res.status(503).json({
        error: "GitHub integration is not configured. Configure partner_settings(github/default).",
      });
      return;
    }
    next(err);
  }
});

router.post("/disconnect", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const deleted = await deleteGitHubInstallationByClientId(clientId);
    res.status(200).json({ ok: true, deleted });
  } catch (err) {
    next(err);
  }
});

router.get("/agents/:agentId/connection", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const agentId = z.string().uuid().parse(req.params.agentId);
    const connections = await listAgentGitHubConnections(clientId, agentId);
    res.status(200).json({ connection: connections[0] ?? null });
  } catch (err) {
    next(err);
  }
});

router.get("/agents/:agentId/connections", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const agentId = z.string().uuid().parse(req.params.agentId);
    const connections = await listAgentGitHubConnections(clientId, agentId);
    res.status(200).json({ connections });
  } catch (err) {
    next(err);
  }
});

router.post("/agents/:agentId/link", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const agentId = z.string().uuid().parse(req.params.agentId);
    const body = z
      .object({
        commitAuthorName: z.string().min(1).optional(),
        commitAuthorEmail: z.string().email().optional(),
        accessLevel: z.enum(["read", "pr_only", "direct_push"]).optional(),
        defaultBranch: z.string().min(1).optional(),
        defaultRepo: z.string().min(1).optional(),
      })
      .parse(req.body ?? {});

    const connection = await linkAgentToGitHub({
      clientId,
      agentId,
      commitAuthorName: body.commitAuthorName ?? "",
      commitAuthorEmail: body.commitAuthorEmail ?? "",
      accessLevel: body.accessLevel,
      defaultBranch: body.defaultBranch,
      defaultRepo: body.defaultRepo,
    });

    res.status(200).json({ connection });
  } catch (err) {
    next(err);
  }
});

router.post("/agents/:agentId/connections/:connectionId/update", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const agentId = z.string().uuid().parse(req.params.agentId);
    const connectionId = z.string().uuid().parse(req.params.connectionId);
    const body = z
      .object({
        commitAuthorName: z.string().min(1).optional(),
        commitAuthorEmail: z.string().email().optional(),
        accessLevel: z.enum(["read", "pr_only", "direct_push"]).optional(),
        defaultBranch: z.string().min(1).optional(),
        defaultRepo: z.string().min(1),
      })
      .parse(req.body ?? {});

    // We model repo links as upserts keyed by (agent_id, default_repo).
    // To "update" a specific connection row by id (including changing repo),
    // delete the old row and upsert the new key.
    const deleted = await deleteGitHubAgentConnectionByIdScoped({ clientId, agentId, connectionId });
    if (!deleted) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }

    const connection = await linkAgentToGitHub({
      clientId,
      agentId,
      commitAuthorName: body.commitAuthorName ?? "",
      commitAuthorEmail: body.commitAuthorEmail ?? "",
      accessLevel: body.accessLevel,
      defaultBranch: body.defaultBranch,
      defaultRepo: body.defaultRepo,
    });

    res.status(200).json({ connection });
  } catch (err) {
    next(err);
  }
});

router.post("/agents/:agentId/connections/:connectionId/unlink", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const agentId = z.string().uuid().parse(req.params.agentId);
    const connectionId = z.string().uuid().parse(req.params.connectionId);
    const deleted = await deleteGitHubAgentConnectionByIdScoped({ clientId, agentId, connectionId });
    res.status(200).json({ ok: true, deleted });
  } catch (err) {
    next(err);
  }
});

router.post("/agents/:agentId/unlink", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const agentId = z.string().uuid().parse(req.params.agentId);
    const deleted = await deleteGitHubAgentConnectionScoped({ clientId, agentId });
    res.status(200).json({ ok: true, deleted });
  } catch (err) {
    next(err);
  }
});

export { router as githubInternalRoutes };
