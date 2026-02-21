import type { Request, Response } from "express";
import { z } from "zod";
import { DbNotConfiguredError } from "../../db/client";
import { ensureSlackDefaultTenant, createTaskForAgentScoped } from "../../db/schema";
import { runAgentTask } from "../../agent/agentLoop";

const slackUrlVerificationSchema = z.object({
  type: z.literal("url_verification"),
  challenge: z.string(),
});

export async function slackHandler(req: Request, res: Response): Promise<void> {
  // MVP: signature verification is intentionally mocked.
  // In production, verify Slack signing secret + timestamp and map Slack team -> client_id.

  const urlVerification = slackUrlVerificationSchema.safeParse(req.body);
  if (urlVerification.success) {
    res.status(200).json({ challenge: urlVerification.data.challenge });
    return;
  }

  const taskText = extractAgentTaskText(req.body);
  if (!taskText) {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  try {
    const { client, agent } = await ensureSlackDefaultTenant();
    const task = await createTaskForAgentScoped({
      clientId: client.id,
      agentId: agent.id,
      taskInput: taskText,
    });

    // Trigger the core agent loop asynchronously to keep Slack ack fast.
    void runAgentTask(task.id).catch((err) => {
      console.error("[slack] runAgentTask failed", err);
    });

    res.status(200).json({
      ok: true,
      message: `Task created and queued for agent '${agent.name}'.`,
      taskId: task.id,
      clientId: client.id,
      agentId: agent.id,
    });
  } catch (err: any) {
    if (err instanceof DbNotConfiguredError) {
      res.status(200).json({
        ok: false,
        error:
          "DATABASE_URL is not configured. Apply migrations and set DATABASE_URL to enable task creation.",
      });
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    res.status(200).json({ ok: false, error: message });
  }
}

function extractAgentTaskText(body: any): string | null {
  // Slash command style: { command: "/agent", text: "do something" }
  if (typeof body?.command === "string" && body.command.trim() === "/agent") {
    const t = String(body.text ?? "").trim();
    return t.length > 0 ? t : null;
  }

  const candidates: unknown[] = [body?.text, body?.event?.text, body?.message?.text];

  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const text = c.trim();
    if (!text) continue;
    if (text.toLowerCase().startsWith("/agent")) {
      const rest = text.slice("/agent".length).trim();
      return rest.length > 0 ? rest : null;
    }
  }

  return null;
}

