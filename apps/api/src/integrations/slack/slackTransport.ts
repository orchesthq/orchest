import type { ChatTransport } from "../../chat/types";
import { slackApi, slackApiGet } from "./slackApiClient";

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

    fetchThreadContext: async ({ conversationId, threadId, maxMessages, strictThreadOnly }) => {
      try {
        const max = Math.max(5, Math.min(200, Number(maxMessages ?? 20)));
        let messages: any[] = [];
        let repliesHasMore = false;
        let usedHistoryFallback = false;
        let repliesFailed = false;
        try {
          // Page through replies so we don't accidentally summarize only the first message/page.
          let cursor: string | undefined;
          const seenTs = new Set<string>();
          while (messages.length < max) {
            const json = await slackApiGet(input.token, "conversations.replies", {
              channel: conversationId,
              ts: threadId,
              limit: Math.min(100, max - messages.length),
              cursor,
            });
            const page: any[] = Array.isArray(json?.messages) ? json.messages : [];
            for (const m of page) {
              const ts = String(m?.ts ?? "");
              if (!ts || seenTs.has(ts)) continue;
              seenTs.add(ts);
              messages.push(m);
              if (messages.length >= max) break;
            }
            const nextCursor = String((json as any)?.response_metadata?.next_cursor ?? "").trim();
            const hasMore = Boolean((json as any)?.has_more) || Boolean(nextCursor);
            if (!hasMore) break;
            repliesHasMore = true;
            if (!nextCursor) break;
            cursor = nextCursor;
          }
        } catch {
          // replies can fail on some surfaces/contexts; history fallback below may still work.
          repliesFailed = true;
        }
        let source = messages;

        // If there's no actual thread (just the triggering message), fall back to channel history so the
        // agent maintains context in channels where people don't use threads.
        if (messages.length <= 1) {
          try {
            const hist = await slackApiGet(input.token, "conversations.history",
              strictThreadOnly
                ? {
                    channel: conversationId,
                    oldest: threadId,
                    inclusive: true,
                    limit: 200,
                  }
                : {
                    channel: conversationId,
                    latest: threadId,
                    inclusive: true,
                    limit: Math.min(200, max + 20),
                  }
            );
            usedHistoryFallback = true;
            const hm: any[] = Array.isArray(hist?.messages) ? hist.messages : [];
            const threadOnly = hm
              .filter((m) => String(m?.thread_ts ?? "") === threadId || String(m?.ts ?? "") === threadId)
              .sort((a, b) => Number(String(a?.ts ?? "0")) - Number(String(b?.ts ?? "0")));
            if (threadOnly.length > 0) {
              source = threadOnly;
            } else if (!strictThreadOnly && hm.length > 1) {
              // Non-strict mode keeps prior behavior for continuity when no thread grouping exists.
              source = hm.reverse(); // oldest → newest
            }
          } catch {
            // ignore
          }
        }

        const allTextMessages = source.filter((m) => typeof m?.text === "string" && m.text.trim().length > 0);
        const textMessages = allTextMessages.slice(-max);
        const lines = textMessages
          .map((m) => {
            const who = m.bot_id || m.subtype === "bot_message" ? "assistant" : "user";
            const t = normalizeSlackText(String(m.text));
            return `${who}: ${t}`;
          });

        if (strictThreadOnly) {
          const threadScopedCount = source.filter(
            (m) => String(m?.thread_ts ?? "") === threadId || String(m?.ts ?? "") === threadId
          ).length;
          if (threadScopedCount === 0) return "";
          // If we only have the root message but root says there are replies, treat as unresolved.
          // Do not require an exact reply_count match: Slack counts can include deleted/hidden/system items.
          const root = source.find((m) => String(m?.ts ?? "") === threadId);
          const expectedReplies = Math.max(0, Number((root as any)?.reply_count ?? 0));
          const observedReplies = source.filter((m) => String(m?.thread_ts ?? "") === threadId).length;
          const appearsRootOnly = source.length <= 1 || observedReplies === 0;
          if ((repliesFailed || usedHistoryFallback) && appearsRootOnly && expectedReplies > 0) {
            return "";
          }
        }
        if (lines.length === 0) return "";

        const maybeTruncated =
          repliesHasMore ||
          allTextMessages.length > max ||
          (usedHistoryFallback && strictThreadOnly && source.length >= 200);
        const metadataLine = maybeTruncated
          ? `Thread source note: this appears to be a long thread; only the latest ${lines.length} messages were included.`
          : `Thread source note: included ${lines.length} messages from this thread.`;

        return ["", "Thread context (most recent):", metadataLine, ...lines].join("\n");
      } catch {
        return "";
      }
    },
  };
}

