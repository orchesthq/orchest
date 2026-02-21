import express from "express";
import { z } from "zod";
import {
  createSlackInstallState,
  enableAgentInSlack,
  getSlackAuthorizeUrl,
  listSlackBotKeys,
} from "../integrations/slack/slackService";
import {
  getSlackAgentLinkByAgentIdAndBotKey,
  getSlackInstallationByClientIdAndBotKey,
  listSlackInstallationsByClientId,
} from "../db/schema";

const router = express.Router();

router.get("/status", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const botKeys = listSlackBotKeys();
    const installations = await listSlackInstallationsByClientId(clientId);

    const byBot = Object.fromEntries(
      botKeys.map((k) => {
        const inst = installations.find((i) => (i as any).bot_key === k) ?? null;
        return [
          k,
          inst
            ? {
                connected: true,
                teamId: inst.team_id,
                teamName: inst.team_name,
                installedAt: inst.installed_at,
              }
            : { connected: false },
        ];
      })
    );

    res.status(200).json({ bots: byBot });
  } catch (err) {
    next(err);
  }
});

router.get("/install-url", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const botKey = z.string().min(1).parse(req.query.bot);
    const agentId = z.string().uuid().optional().parse(req.query.agentId ?? undefined);
    const state = await createSlackInstallState({ clientId, botKey, agentId: agentId ?? null });
    const url = getSlackAuthorizeUrl({ botKey, state });
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
        botKey: z.string().min(1),
        iconUrl: z.string().url().optional(),
      })
      .parse(req.body ?? {});

    const installation = await getSlackInstallationByClientIdAndBotKey({
      clientId,
      botKey: body.botKey,
    });
    if (!installation) {
      res.status(400).json({ error: "This Slack bot is not connected yet. Install it first." });
      return;
    }

    const link = await enableAgentInSlack({
      clientId,
      agentId,
      botKey: body.botKey,
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
    const botKey = z.string().min(1).parse(req.query.bot);
    const link = await getSlackAgentLinkByAgentIdAndBotKey({ clientId, agentId, botKey });
    res.status(200).json({ link });
  } catch (err) {
    next(err);
  }
});

export { router as slackInternalRoutes };

