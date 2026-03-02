import express from "express";
import crypto from "crypto";
import { z } from "zod";
import { getPartnerSetting, getGitHubInstallationByInstallationId } from "../db/schema";
import { syncGitHubRepoPathsToKb } from "../kb/githubSync";

const router = express.Router();

const githubSettingsSchema = z
  .object({
    webhookSecret: z.string().min(8).optional(),
  })
  .passthrough();

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function verifyGitHubSignature(input: { secret: string; rawBody: Buffer; signature256: string | null }): boolean {
  const sig = (input.signature256 ?? "").trim();
  if (!sig.startsWith("sha256=")) return false;
  const theirHex = sig.slice("sha256=".length);
  const ours = crypto.createHmac("sha256", input.secret).update(input.rawBody).digest("hex");
  return timingSafeEqualHex(ours, theirHex);
}

router.post("/webhook", async (req, res) => {
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.from("");
  const event = String(req.header("x-github-event") ?? "").trim();
  const signature256 = req.header("x-hub-signature-256") ?? null;

  const settingsRow = await getPartnerSetting({ partner: "github", key: "default" }).catch(() => null);
  const parsed = githubSettingsSchema.safeParse(settingsRow?.settings ?? null);
  const secret = parsed.success ? parsed.data.webhookSecret : undefined;
  if (!secret) {
    res.status(503).json({ error: "GitHub webhook secret not configured (partner_settings github/default webhookSecret)" });
    return;
  }

  const ok = verifyGitHubSignature({ secret, rawBody, signature256 });
  if (!ok) {
    res.status(401).json({ error: "Invalid GitHub signature" });
    return;
  }

  let payload: any = null;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  // URL verification isn't a GitHub concept; respond OK for unknown events.
  if (event !== "push") {
    res.status(200).json({ ok: true, ignored: event || "unknown" });
    return;
  }

  const installationId = Number(payload?.installation?.id ?? 0);
  const repoFullName = String(payload?.repository?.full_name ?? "").trim();
  const afterSha = String(payload?.after ?? "").trim();
  const refFull = String(payload?.ref ?? "").trim(); // refs/heads/main
  const ref = refFull.startsWith("refs/heads/") ? refFull.slice("refs/heads/".length) : refFull || "main";

  if (!installationId || !repoFullName || !afterSha) {
    res.status(200).json({ ok: true, skipped: true });
    return;
  }

  const installation = await getGitHubInstallationByInstallationId(installationId).catch(() => null);
  if (!installation) {
    res.status(200).json({ ok: true, skipped: true });
    return;
  }

  const commits: any[] = Array.isArray(payload?.commits) ? payload.commits : [];
  const changed = new Set<string>();
  const removed = new Set<string>();
  for (const c of commits) {
    for (const p of Array.isArray(c?.added) ? c.added : []) changed.add(String(p));
    for (const p of Array.isArray(c?.modified) ? c.modified : []) changed.add(String(p));
    for (const p of Array.isArray(c?.removed) ? c.removed : []) removed.add(String(p));
  }

  // If payload doesn't include commits (rare), don't do anything.
  if (changed.size === 0 && removed.size === 0) {
    res.status(200).json({ ok: true, skipped: true });
    return;
  }

  console.log("[kb][github-webhook] push", {
    repo: repoFullName,
    ref,
    changed: changed.size,
    removed: removed.size,
  });

  const result = await syncGitHubRepoPathsToKb({
    clientId: installation.client_id,
    repoFullName,
    ref,
    sha: afterSha,
    changedPaths: Array.from(changed).slice(0, 300),
    removedPaths: Array.from(removed).slice(0, 300),
  }).catch((err) => {
    console.error("[kb][github-webhook] sync failed", err);
    return null;
  });

  res.status(200).json({ ok: true, result });
});

export { router as githubWebhookRoutes };

