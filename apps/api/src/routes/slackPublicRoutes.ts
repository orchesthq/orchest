import express from "express";
import { z } from "zod";
import {
  enableAgentInSlack,
  handleSlackOAuthCallback,
  handleSlackEvent,
  listSlackSigningSecrets,
  verifySlackSignatureAny,
} from "../integrations/slack/slackService";

const router = express.Router();

router.get("/callback", async (req, res, next) => {
  try {
    const code = z.string().min(1).parse(req.query.code);
    const state = z.string().min(1).parse(req.query.state);

    const { installation, agentId } = await handleSlackOAuthCallback({ code, state });

    const botKey = installation.bot_key ?? null;
    if (agentId && installation.client_id && botKey) {
      await enableAgentInSlack({
        clientId: installation.client_id,
        agentId,
        botKey,
      });
      const base = process.env.DASHBOARD_BASE_URL?.replace(/\/+$/, "") ?? "";
      const redirect = base ? `${base}/app/agents/${agentId}?slack=linked` : "/";
      res.redirect(302, redirect);
      return;
    }

    const redirect = process.env.DASHBOARD_BASE_URL
      ? `${process.env.DASHBOARD_BASE_URL.replace(/\/+$/, "")}/app/integrations/slack?connected=1`
      : "/";

    res.redirect(302, redirect);
  } catch (err) {
    next(err);
  }
});

export { router as slackPublicRoutes };

export async function slackEventsHandler(req: express.Request, res: express.Response) {
  const signingSecrets = await (async () => {
    try {
      return await listSlackSigningSecrets();
    } catch (err) {
      console.error("[slack] signing secrets not configured", err);
      return null;
    }
  })();
  if (!signingSecrets) {
    res.status(503).json({ error: "Slack signing secrets not configured" });
    return;
  }

  const rawBody: Buffer = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.from("");
  const timestamp = req.header("x-slack-request-timestamp");
  const signature = req.header("x-slack-signature");

  const ok = verifySlackSignatureAny({
    signingSecrets,
    timestamp,
    signature,
    rawBody,
  });

  if (!ok) {
    res.status(401).json({ error: "Invalid Slack signature" });
    return;
  }

  const payload = JSON.parse(rawBody.toString("utf8"));

  // URL verification handshake.
  if (payload?.type === "url_verification" && typeof payload?.challenge === "string") {
    res.status(200).json({ challenge: payload.challenge });
    return;
  }

  // Ack fast (Slack expects 3s).
  res.status(200).json({ ok: true });

  // Process asynchronously.
  void handleSlackEvent({ payload }).catch((err) => {
    console.error("[slack] handleSlackEvent failed", err);
  });
}

