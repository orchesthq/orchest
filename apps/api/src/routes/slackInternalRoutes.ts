import express from "express";
import { z } from "zod";
import {
  createSlackInstallState,
  enableAgentInSlack,
  getSlackAuthorizeUrl,
} from "../integrations/slack/slackService";
import { getSlackAgentLinkByAgentId, getSlackInstallationByClientId } from "../db/schema";

const router = express.Router();

router.get("/status", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const installation = await getSlackInstallationByClientId(clientId);
    res.status(200).json({
      connected: Boolean(installation),
      installation: installation
        ? {
            teamId: installation.team_id,
            teamName: installation.team_name,
            installedAt: installation.installed_at,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/install-url", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const state = await createSlackInstallState(clientId);
    const url = getSlackAuthorizeUrl({ state });
    res.status(200).json({ url });
  } catch (err) {
    next(err);
  }
});

router.post("/agents/:agentId/enable", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const agentId = z.string().uuid().parse(req.params.agentId);
    const body = z
      .object({
        iconUrl: z.string().url().optional(),
      })
      .parse(req.body ?? {});

    const link = await enableAgentInSlack({
      clientId,
      agentId,
      iconUrl: body.iconUrl ?? null,
    });

    res.status(200).json({ link });
  } catch (err) {
    next(err);
  }
});

router.get("/agents/:agentId/link", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const agentId = z.string().uuid().parse(req.params.agentId);
    const link = await getSlackAgentLinkByAgentId({ clientId, agentId });
    res.status(200).json({ link });
  } catch (err) {
    next(err);
  }
});

export { router as slackInternalRoutes };

