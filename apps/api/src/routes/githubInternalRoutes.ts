import express from "express";
import { z } from "zod";
import {
  getGitHubInstallUrl,
  getGitHubStatus,
  getAgentGitHubConnection,
  linkAgentToGitHub,
  handleGitHubInstallationCallback,
  listInstallationRepos,
} from "../integrations/github/githubService";

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

router.get("/agents/:agentId/connection", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const agentId = z.string().uuid().parse(req.params.agentId);
    const connection = await getAgentGitHubConnection(clientId, agentId);
    res.status(200).json({ connection });
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

export { router as githubInternalRoutes };
