export type ThreadSubscription = {
  surface: string;
  accountId: string;
  conversationId: string;
  threadId: string;
  clientId: string;
  agentId: string;
  subscribedAtMs: number;
  expiresAtMs: number;
};

const THREAD_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_SUBSCRIPTIONS = 5000;

function keyOf(input: { surface: string; accountId: string; conversationId: string; threadId: string }): string {
  return `${input.surface}:${input.accountId}:${input.conversationId}:${input.threadId}`;
}

const subs = new Map<string, ThreadSubscription>();

export function subscribeThread(input: Omit<ThreadSubscription, "subscribedAtMs" | "expiresAtMs">): void {
  const now = Date.now();
  subs.set(
    keyOf(input),
    Object.freeze({
      ...input,
      subscribedAtMs: now,
      expiresAtMs: now + THREAD_TTL_MS,
    })
  );

  // Best-effort prune.
  if (subs.size > MAX_SUBSCRIPTIONS) pruneExpired();
}

export function getThreadSubscription(input: {
  surface: string;
  accountId: string;
  conversationId: string;
  threadId: string;
}): ThreadSubscription | null {
  const k = keyOf(input);
  const v = subs.get(k);
  if (!v) return null;
  if (v.expiresAtMs < Date.now()) {
    subs.delete(k);
    return null;
  }
  return v;
}

export function pruneExpired(): void {
  const now = Date.now();
  for (const [k, v] of subs) {
    if (v.expiresAtMs < now) subs.delete(k);
  }
}

