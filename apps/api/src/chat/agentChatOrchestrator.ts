import {
  createTaskForAgentScoped,
  getAgentByIdScoped,
  listAgentMemoriesByTypeScoped,
} from "../db/schema";
import { runAgentTask } from "../agent/agentLoop";
import { tryConversationalReply } from "../services/openaiService";
import type { ChatAuthor, ChatTransport, InboundChatMessage } from "./types";

const DOC_LIKE =
  /\b(canvas|canvases|doc|docs|prd|spec|one-?pager|write-?up|writeup|notes|confluence|notion|google doc)\b/i;
const QUESTION_LIKE =
  /(\?\s*)$/i;
const QUESTION_WORD =
  /\b(what|where|how|why|when|who)\b/i;
const QUESTION_START =
  /^\s*(can you|could you|do you know|does it|is it possible|what's|whats|where's|wheres|how's|hows)\b/i;

export type PlanAckGenerator = (input: {
  agentName: string;
  agentRole: string;
  systemPrompt: string;
  taskText: string;
  plan: { steps: string[]; notes?: string };
  profileMemories: string[];
}) => Promise<string | null>;

export type OrchestratorOptions = {
  ackGenerator?: PlanAckGenerator;
  /**
   * Override routing heuristics (transport can supply stronger hints).
   * If omitted, heuristics run on the message text.
   */
  forceTask?: boolean;
  forceConversational?: boolean;
  forceSuppressPlanAck?: boolean;
};

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

    let threadContext = "";
    if (msg.threadId && transport.fetchThreadContext) {
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
      taskInput: `${text}${threadContext}`,
    });

    let postedProgressHeader = false;
    const postProgress = async (t: string) => {
      const clipped = String(t ?? "").trim();
      if (!clipped) return;
      if (!postedProgressHeader) {
        postedProgressHeader = true;
        await transport.postProgress({
          conversationId: msg.conversationId,
          threadId: msg.threadId,
          text: "I’ll share quick progress notes in this thread as I work.",
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
      onAck: suppressPlanAck
        ? undefined
        : async () => {
            if (input.options?.ackGenerator) {
              const ack = await input.options.ackGenerator({
                agentName: agent.name,
                agentRole: agent.role,
                systemPrompt: agent.system_prompt,
                taskText: text,
                plan: { steps: [] },
                profileMemories: profileMemories.map((m) => m.content),
              }).catch(() => null);
              if (ack) {
                await transport.postMessage({
                  conversationId: msg.conversationId,
                  threadId: msg.threadId,
                  text: ack,
                  author,
                });
                return;
              }
            }

            await transport.postMessage({
              conversationId: msg.conversationId,
              threadId: msg.threadId,
              text: "On it.",
              author,
            });
          },
      onPlanReady: suppressPlanAck
        ? undefined
        : async (plan) => {
            if (input.options?.ackGenerator) {
              const ack = await input.options.ackGenerator({
                agentName: agent.name,
                agentRole: agent.role,
                systemPrompt: agent.system_prompt,
                taskText: text,
                plan,
                profileMemories: profileMemories.map((m) => m.content),
              }).catch(() => null);
              if (ack) {
                await transport.postMessage({
                  conversationId: msg.conversationId,
                  threadId: msg.threadId,
                  text: ack,
                  author,
                });
                return;
              }
            }

            // Generic fallback.
            if (plan.steps.length === 0) {
              await transport.postMessage({
                conversationId: msg.conversationId,
                threadId: msg.threadId,
                text: "On it.",
                author,
              });
              return;
            }
            const steps = plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
            await transport.postMessage({
              conversationId: msg.conversationId,
              threadId: msg.threadId,
              text: `On it.\n\nPlan:\n${steps}`,
              author,
            });
          },
      onProgress: async (u) => {
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
        await transport.postMessage({
          conversationId: msg.conversationId,
          threadId: msg.threadId,
          text: `I hit an error while running that: ${msgText}`,
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

