import type { ChatTransport } from "../../chat/types";
import { slackApi } from "./slackApiClient";

const CONTEXT_DEBUG = true;

function normalizeSlackText(text: string): string {
  return String(text ?? "")
    .replace(/<@[A-Z0-9]+>/g, "") // strip mention tokens
    .replace(/\s+/g, " ")
    .trim();
}

function slackMrkdwnFromMarkdown(text: string): string {
  let s = String(text ?? "");
  // Headings: "## Title" -> "*Title*"
  s = s
    .split("\n")
    .map((line) => {
      const m = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
      if (!m) return line;
      const title = (m[2] ?? "").trim();
      return title ? `*${title}*` : line;
    })
    .join("\n");

  // Bold: **text** -> *text*
  s = s.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Horizontal rules / separators.
  s = s.replace(/^\s*---\s*$/gm, "────────");

  return s.trim();
}

async function postSlackTextChunked(input: {
  token: string;
  channel: string;
  threadTs?: string | null;
  text: string;
  username?: string | null;
  iconUrl?: string | null;
}) {
  const maxLen = 3500;
  const raw = slackMrkdwnFromMarkdown(String(input.text ?? ""));
  const chunks: string[] = [];
  let remaining = raw;
  while (remaining.length > maxLen) {
    // Prefer splitting on paragraph boundaries.
    let idx = remaining.lastIndexOf("\n\n", maxLen);
    if (idx < 500) idx = remaining.lastIndexOf("\n", maxLen);
    if (idx < 500) idx = maxLen;
    chunks.push(remaining.slice(0, idx).trim());
    remaining = remaining.slice(idx).trim();
  }
  if (remaining.trim()) chunks.push(remaining.trim());

  for (const c of chunks) {
    await slackApi(input.token, "chat.postMessage", {
      channel: input.channel,
      thread_ts: input.threadTs ?? undefined,
      text: c,
      username: input.username ?? undefined,
      icon_url: input.iconUrl ?? undefined,
    });
  }
}

export function createSlackTransport(input: { token: string }): ChatTransport {
  return {
    surface: "slack",

    postMessage: async ({ conversationId, threadId, text, author }) => {
      await postSlackTextChunked({
        token: input.token,
        channel: conversationId,
        threadTs: threadId ?? null,
        text,
        username: author?.displayName ?? null,
        iconUrl: author?.iconUrl ?? null,
      });
    },

    postProgress: async ({ conversationId, threadId, text, author, isHeader }) => {
      const out = isHeader ? String(text ?? "").trim() : "_" + String(text ?? "").replace(/_/g, "\\_").trim() + "_";
      await slackApi(input.token, "chat.postMessage", {
        channel: conversationId,
        thread_ts: threadId ?? undefined,
        text: out,
        username: author?.displayName ?? undefined,
        icon_url: author?.iconUrl ?? undefined,
      });
    },

    fetchThreadContext: async ({ conversationId, threadId }) => {
      try {
        if (CONTEXT_DEBUG) {
          console.log("[slack][context] fetchThreadContext:start", {
            conversationId,
            threadId,
          });
        }
        let messages: any[] = [];
        try {
          // `inclusive` can be rejected by Slack in this call shape; keep params minimal.
          const json = await slackApi(input.token, "conversations.replies", {
            channel: conversationId,
            ts: threadId,
            limit: 12,
          });
          messages = Array.isArray(json?.messages) ? json.messages : [];
        } catch (err) {
          if (CONTEXT_DEBUG) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log("[slack][context] fetchThreadContext:replies_failed", {
              conversationId,
              threadId,
              error: msg,
            });
          }
        }
        let source = messages;

        // If there's no actual thread (just the triggering message), fall back to channel history so the
        // agent maintains context in channels where people don't use threads.
        if (messages.length <= 1) {
          try {
            const hist = await slackApi(input.token, "conversations.history", {
              channel: conversationId,
              latest: threadId,
              inclusive: true,
              limit: 12,
            });
            const hm: any[] = Array.isArray(hist?.messages) ? hist.messages : [];
            if (hm.length > 1) source = hm.reverse(); // oldest → newest
            if (CONTEXT_DEBUG) {
              console.log("[slack][context] fetchThreadContext:history_fallback", {
                conversationId,
                threadId,
                repliesCount: messages.length,
                historyCount: hm.length,
              });
            }
          } catch {
            // ignore
            if (CONTEXT_DEBUG) {
              console.log("[slack][context] fetchThreadContext:history_fallback_failed", {
                conversationId,
                threadId,
              });
            }
          }
        }

        const lines = source
          .filter((m) => typeof m?.text === "string" && m.text.trim().length > 0)
          .slice(-10)
          .map((m) => {
            const who = m.bot_id || m.subtype === "bot_message" ? "assistant" : "user";
            const t = normalizeSlackText(String(m.text));
            return `${who}: ${t}`;
          });

        if (lines.length === 0) return "";
        if (CONTEXT_DEBUG) {
          console.log("[slack][context] fetchThreadContext:done", {
            conversationId,
            threadId,
            repliesCount: messages.length,
            sourceMessages: source.length,
            outputLines: lines.length,
          });
        }
        return ["", "Thread context (most recent):", ...lines].join("\n");
      } catch (err) {
        if (CONTEXT_DEBUG) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log("[slack][context] fetchThreadContext:error", {
            conversationId,
            threadId,
            error: msg,
          });
        }
        return "";
      }
    },
  };
}

