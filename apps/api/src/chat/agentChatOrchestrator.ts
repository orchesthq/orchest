import {
  createTaskForAgentScoped,
  getAgentByIdScoped,
  listAgentMemoriesByTypeScoped,
} from "../db/schema";
import { runAgentTask } from "../agent/agentLoop";
import type { ContextMode, MemoryContextPolicy, SingleSourceType } from "../agent/memoryService";
import { generateAgentNotice, generatePlanAck, tryConversationalReply } from "../services/openaiService";
import type { ChatAuthor, ChatTransport, InboundChatMessage } from "./types";

const DOC_LIKE =
  /\b(canvas|canvases|doc|docs|prd|spec|one-?pager|write-?up|writeup|notes|confluence|notion|google doc)\b/i;
const QUESTION_LIKE =
  /(\?\s*)$/i;
const QUESTION_WORD =
  /\b(what|where|how|why|when|who)\b/i;
const QUESTION_START =
  /^\s*(can you|could you|do you know|does it|is it possible|what's|whats|where's|wheres|how's|hows)\b/i;
const CONTINUATION_LIKE =
  /\b(continue|pick up|as discussed|same branch|where we left off|remember|last (time|week|day)|we were working on)\b/i;
const SUMMARIZE_THREAD_LIKE =
  /\b(summarize|summary|recap|tl;dr)\b.*\b(thread|conversation|chat)\b|\b(this|current)\s+(thread|conversation|chat)\b/i;
const SUMMARIZE_EXTERNAL_LIKE =
  /\b(summarize|summary|recap|tl;dr)\b.*\b(document|doc|file|text|content|notes|message)\b|\b(this)\s+(document|doc|file|text|content)\b/i;

export type OrchestratorOptions = {
  /**
   * Override routing heuristics (transport can supply stronger hints).
   * If omitted, heuristics run on the message text.
   */
  forceTask?: boolean;
  forceConversational?: boolean;
  forceSuppressPlanAck?: boolean;
};

function decideContextRouting(input: {
  msg: InboundChatMessage;
  text: string;
}): {
  contextMode: ContextMode;
  singleSourceType?: SingleSourceType;
  hasActiveSession: boolean;
  sessionScore: number;
  contextPolicy: MemoryContextPolicy;
} {
  const t = String(input.text ?? "");

  const summarizeThread = Boolean(input.msg.threadId) && SUMMARIZE_THREAD_LIKE.test(t);
  if (summarizeThread) {
    return {
      contextMode: "single_source",
      singleSourceType: "thread",
      hasActiveSession: true,
      sessionScore: 999,
      contextPolicy: "session_primary",
    };
  }

  const summarizeExternal = SUMMARIZE_EXTERNAL_LIKE.test(t) && !SUMMARIZE_THREAD_LIKE.test(t);
  if (summarizeExternal) {
    return {
      contextMode: "single_source",
      singleSourceType: "external",
      hasActiveSession: false,
      sessionScore: 0,
      contextPolicy: "kb_primary_memory_assist",
    };
  }

  let score = 0;

  // Highest indicator: same thread continuity.
  if (input.msg.threadId) score += 9;
  // Explicit continuation language.
  if (CONTINUATION_LIKE.test(t)) score += 5;
  // In DMs, conversation continuity is still meaningful even without thread ids.
  if (!input.msg.threadId && input.msg.kind === "dm") score += 2;
  // Questions often imply immediate conversational continuity.
  if (isQuestionLike(t)) score += 1;

  const hasActiveSession = score >= 8;
  if (!hasActiveSession) {
    return {
      contextMode: "multi_source",
      hasActiveSession: false,
      sessionScore: score,
      contextPolicy: "kb_primary_memory_assist",
    };
  }

  // If same thread or explicit continuation intent is present, session is primary.
  if (input.msg.threadId || CONTINUATION_LIKE.test(t)) {
    return {
      contextMode: "multi_source",
      hasActiveSession: true,
      sessionScore: score,
      contextPolicy: "session_primary",
    };
  }
  return {
    contextMode: "multi_source",
    hasActiveSession: true,
    sessionScore: score,
    contextPolicy: "kb_plus_memory",
  };
}

async function resolveSingleSourceContext(input: {
  routing: ReturnType<typeof decideContextRouting>;
  msg: InboundChatMessage;
  transport: ChatTransport;
}): Promise<{ ok: true; contextText: string } | { ok: false; fallbackMessage: string; context: string }> {
  if (input.routing.singleSourceType === "thread") {
    if (!input.msg.threadId) {
      return {
        ok: false,
        fallbackMessage: "I couldn't identify which thread to summarize. Please ask from the target thread.",
        context: "Could not identify a thread id for a thread-summary request.",
      };
    }
    if (!input.transport.fetchThreadContext) {
      return {
        ok: false,
        fallbackMessage: "I can't read thread history on this surface yet, so I can't safely summarize this thread.",
        context: "Thread-summary request arrived on a surface without thread-history access.",
      };
    }
    const threadText = await input.transport
      .fetchThreadContext({
        conversationId: input.msg.conversationId,
        threadId: input.msg.threadId,
        maxMessages: 25,
      })
      .catch(() => "");
    const cleaned = String(threadText ?? "").trim();
    if (!cleaned) {
      return {
        ok: false,
        fallbackMessage:
          "I couldn't fetch messages for this thread summary. Please retry in-thread or paste the content to summarize.",
        context: "Thread-summary request failed because no thread content was retrieved.",
      };
    }
    return { ok: true, contextText: cleaned };
  }

  if (input.routing.singleSourceType === "external") {
    // Future-ready source keys for adapters that pass explicit external content.
    const sourceKeys = ["source_text", "external_source_text", "document_text", "content_text"] as const;
    for (const key of sourceKeys) {
      const v = input.msg.context?.[key];
      if (typeof v === "string" && v.trim()) {
        const clipped = v.trim().slice(0, 40_000);
        return { ok: true, contextText: `External source content:\n${clipped}` };
      }
    }
    return {
      ok: false,
      fallbackMessage:
        "I can't access the external documents yet. Please paste the content to summarize or connect me to the external tool first.",
      context: "External-source summary requested, but no external tool is available yet to read the content.",
    };
  }

  return {
    ok: false,
    fallbackMessage: "I couldn't determine the requested single source. Please specify what to summarize.",
    context: "Single-source mode was selected, but source type could not be determined.",
  };
}

function isDocLike(text: string): boolean {
  return DOC_LIKE.test(String(text ?? ""));
}
function isQuestionLike(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  return QUESTION_LIKE.test(t) || QUESTION_WORD.test(t) || QUESTION_START.test(t);
}

export async function handleInboundChatMessage(input: {
  msg: InboundChatMessage;
  transport: ChatTransport;
  author?: ChatAuthor;
  options?: OrchestratorOptions;
}): Promise<void> {
  const { msg, transport } = input;
  const text = String(msg.text ?? "").trim();
  if (!text) return;

  const agent = await getAgentByIdScoped(msg.clientId, msg.agentId);
  if (!agent) return;

  const author: ChatAuthor = input.author ?? {
    displayName: (msg.context?.displayName as string | undefined) ?? null,
    iconUrl: (msg.context?.iconUrl as string | undefined) ?? null,
  };

  const docLike = isDocLike(text);
  const questionLike = isQuestionLike(text);
  const questionOnly = questionLike && !docLike;

  const forceTask = Boolean(input.options?.forceTask);
  const forceConversational = Boolean(input.options?.forceConversational);
  const suppressPlanAck =
    Boolean(input.options?.forceSuppressPlanAck) || (questionOnly && !forceConversational);

  const runTaskFlow = async () => {
    const profileMemories = await listAgentMemoriesByTypeScoped({
      clientId: msg.clientId,
      agentId: agent.id,
      memoryType: "profile",
      limit: 10,
    }).catch(() => []);
    const profileMemoryStrings = profileMemories.slice(0, 1).map((m) => m.content);

    const generateNotice = async (context: string, fallback: string) => {
      return await generateAgentNotice({
        agentName: agent.name,
        agentRole: agent.role,
        systemPrompt: agent.system_prompt,
        profileMemories: profileMemoryStrings,
        context,
        fallback,
      }).catch(() => fallback);
    };

    const routing = decideContextRouting({ msg, text });
    let threadContext = "";
    let singleSourceContext = "";
    if (routing.contextMode === "single_source") {
      const resolved = await resolveSingleSourceContext({ routing, msg, transport });
      if (!resolved.ok) {
        const notice = await generateNotice(resolved.context, resolved.fallbackMessage);
        await transport.postMessage({
          conversationId: msg.conversationId,
          threadId: msg.threadId,
          text: notice,
          author,
        });
        return;
      }
      singleSourceContext = `\n\nSource context (single source):\n${resolved.contextText}`;
      if (routing.singleSourceType === "thread") {
        const readingNotice = await generateNotice(
          "Tell the user in one sentence that you're reading this thread and will summarize it.",
          "I'm reading this thread now and will summarize it for you."
        );
        await transport.postMessage({
          conversationId: msg.conversationId,
          threadId: msg.threadId,
          text: readingNotice,
          author,
        });
      }
    } else if (msg.threadId && transport.fetchThreadContext) {
      threadContext = await transport
        .fetchThreadContext({
          conversationId: msg.conversationId,
          threadId: msg.threadId,
          maxMessages: 10,
        })
        .catch(() => "");
    }

    const task = await createTaskForAgentScoped({
      clientId: msg.clientId,
      agentId: agent.id,
      taskInput:
        `${text}${singleSourceContext || threadContext}` +
        [
          "",
          "Context policy:",
          `- contextMode: ${routing.contextMode}`,
          `- contextPolicy: ${routing.contextPolicy}`,
          `- hasActiveSession: ${routing.hasActiveSession ? "yes" : "no"}`,
          `- sessionScore: ${routing.sessionScore}`,
          ...(routing.singleSourceType ? [`- singleSourceType: ${routing.singleSourceType}`] : []),
          ...(routing.contextMode === "single_source"
            ? [
                "- Use only the specified source context for factual content.",
                "- Do not use episodic/semantic memory or KB to add extra facts.",
                "- If required source content is missing, say so explicitly instead of guessing.",
              ]
            : ["- Use session memory strongly only when hasActiveSession is yes."]),
        ].join("\n"),
    });

    let postedAck = false;
    const postAck = async (plan: { steps: string[]; notes?: string }) => {
      if (postedAck || suppressPlanAck) return;
      postedAck = true;

      const ack = await generatePlanAck({
        agentName: agent.name,
        agentRole: agent.role,
        systemPrompt: agent.system_prompt,
        taskText: text,
        plan,
        profileMemories: profileMemoryStrings,
      }).catch(() => null);

      await transport.postMessage({
        conversationId: msg.conversationId,
        threadId: msg.threadId,
        text:
          ack ||
          (await generateNotice(
            "Acknowledge starting work on the user's request and promise a single follow-up answer.",
            "On it - I'll look this up and come back with one answer."
          )),
        author,
      });
    };

    let postedProgressHeader = false;
    const postProgress = async (t: string) => {
      const clipped = String(t ?? "").trim();
      if (!clipped) return;
      if (!postedProgressHeader) {
        postedProgressHeader = true;
        const header = await generateNotice(
          "Send a brief progress-header sentence that you'll post quick updates while working.",
          "I'll share quick progress notes in this thread as I work."
        );
        await transport.postProgress({
          conversationId: msg.conversationId,
          threadId: msg.threadId,
          text: header,
          author,
          isHeader: true,
        });
      }
      await transport.postProgress({
        conversationId: msg.conversationId,
        threadId: msg.threadId,
        text: clipped,
        author,
      });
    };

    void runAgentTask(task.id, {
      memoryContext: {
        surface: msg.surface,
        accountId: msg.accountId,
        conversationId: msg.conversationId,
        threadId: msg.threadId ?? null,
        senderId: msg.senderId,
        sessionId: msg.threadId
          ? `${msg.surface}:${msg.accountId}:${msg.conversationId}:thread:${msg.threadId}`
          : `${msg.surface}:${msg.accountId}:${msg.conversationId}:session`,
        contextMode: routing.contextMode,
        singleSourceType: routing.singleSourceType,
        hasActiveSession: routing.hasActiveSession,
        sessionScore: routing.sessionScore,
        contextPolicy: routing.contextPolicy,
      },
      onAck: async () => {
        await postAck({ steps: [] });
      },
      onPlanReady: async (plan) => {
        await postAck(plan);
      },
      onProgress: async (u) => {
        if (routing.contextMode === "single_source") return;
        if (!u.text) return;
        await postProgress(u.text);
      },
    })
      .then(async (result) => {
        await transport.postMessage({
          conversationId: msg.conversationId,
          threadId: msg.threadId,
          text: result.summary,
          author,
        });
      })
      .catch(async (err) => {
        const msgText = err instanceof Error ? err.message : String(err);
        const notice = await generateNotice(
          `You hit an execution error while handling the user's request. Error detail: ${msgText}`,
          `I hit an error while running that: ${msgText}`
        );
        await transport.postMessage({
          conversationId: msg.conversationId,
          threadId: msg.threadId,
          text: notice,
          author,
        });
      });
  };

  // Routing:
  // - Doc/question-like: task flow (to allow KB/tools), suppress plan ack for question-only.
  // - Otherwise: conversational shortcut first, then task flow.
  if (forceTask || docLike || questionLike) {
    await runTaskFlow();
    return;
  }

  if (!forceConversational) {
    const conversational = await tryConversationalReply({
      agentName: agent.name,
      agentRole: agent.role,
      systemPrompt: agent.system_prompt,
      userMessage: text,
    });
    if (conversational.type === "chat") {
      await transport.postMessage({
        conversationId: msg.conversationId,
        threadId: msg.threadId,
        text: conversational.reply,
        author,
      });
      return;
    }
  }

  await runTaskFlow();
}

