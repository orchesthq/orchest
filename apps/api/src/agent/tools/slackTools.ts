import { z } from "zod";
import { ToolRegistry, type ToolContext } from "./registry";
import {
  getAgentByIdScoped,
  getSlackAgentLinkByAgentId,
  getSlackInstallationByClientIdAndBotKey,
} from "../../db/schema";
import { slackApi } from "../../integrations/slack/slackApiClient";
import {
  buildCanvasTitleAndMarkdown,
  createSlackCanvasFromMarkdown,
  splitSlackConversationAndDocument,
} from "../../integrations/slack/canvasPublisher";

export function registerSlackTools(registry: ToolRegistry): void {
  registry.register({
    name: "slack_canvas_publish",
    description:
      "Create or update a Slack Canvas from markdown and return a permalink. Use this to publish long-form documents; then keep the chat reply short and link to the Canvas.",
    inputSchema: z.object({
      markdown: z.string().min(1),
      /** Optional title override; if omitted, a title is derived from markdown/task. */
      title: z.string().min(1).optional(),
      /** Optional: original user task text to help derive a good title + summary header. */
      taskText: z.string().optional(),
      /** Optional: Slack channel id. Defaults to the agent's linked DM channel. */
      channelId: z.string().optional(),
      /** Optional: requesting Slack user id (for granting access in DMs). */
      requestUserId: z.string().optional(),
    }),
    execute: async (ctx: ToolContext, args) => {
      const link = await getSlackAgentLinkByAgentId({ clientId: ctx.clientId, agentId: ctx.agentId }).catch(() => null);
      if (!link) {
        return { ok: false, message: "Slack is not linked for this agent. Enable this agent in Slack first." };
      }

      const botKey = (link as any).bot_key ?? "orchest";
      const installation = await getSlackInstallationByClientIdAndBotKey({
        clientId: ctx.clientId,
        botKey,
      }).catch(() => null);
      if (!installation) {
        return { ok: false, message: "Slack is not connected for this client (no installation found)." };
      }

      const agent = await getAgentByIdScoped(ctx.clientId, ctx.agentId).catch(() => null);
      const agentName = agent?.name ?? link.display_name ?? "Agent";

      const channelId = String(args.channelId ?? link.dm_channel_id ?? "").trim();
      if (!channelId) {
        return { ok: false, message: "No Slack channel is available for this agent (missing dm_channel_id)." };
      }

      const { conversation, document } = splitSlackConversationAndDocument(args.markdown);
      const { title, markdown } = buildCanvasTitleAndMarkdown({
        taskText: String(args.taskText ?? ""),
        agentName,
        documentMarkdown: document,
        titleOverride: args.title ?? null,
      });

      const canvas = await createSlackCanvasFromMarkdown({
        token: installation.bot_access_token,
        title,
        markdown,
        channelId,
      });

      if (args.requestUserId && /^D/.test(channelId) && canvas.canvasId) {
        try {
          await slackApi(installation.bot_access_token, "canvases.access.set", {
            canvas_id: canvas.canvasId,
            user_ids: [args.requestUserId],
            access_level: "write",
          });
        } catch {
          // best-effort
        }
      }

      if (!canvas.canvasId) {
        return { ok: false, message: "Canvas creation failed (no canvas id returned)." };
      }

      if (!canvas.url) {
        return {
          ok: true,
          message:
            "Canvas created, but Slack did not return a permalink (files.info/auth.test failed). Check Slack scopes (files:read) or workspace plan restrictions.",
          metadata: {
            canvasId: canvas.canvasId,
            url: null,
            title,
            conversation,
            artifacts: [
              {
                tool: "slack_canvas_publish",
                kind: "document",
                id: canvas.canvasId,
                title,
                container: "slack_canvas",
                status: "created_without_url",
              },
            ],
          },
        };
      }

      return {
        ok: true,
        message: `Canvas created: ${canvas.url}`,
        metadata: {
          canvasId: canvas.canvasId,
          url: canvas.url,
          title,
          conversation,
          artifacts: [
            {
              tool: "slack_canvas_publish",
              kind: "document",
              id: canvas.canvasId,
              url: canvas.url,
              title,
              container: "slack_canvas",
              status: "created",
            },
          ],
        },
      };
    },
  });
}

