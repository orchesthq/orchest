export type ChatSurfaceId = "slack" | (string & {});

export type ChatAuthor = {
  displayName?: string | null;
  iconUrl?: string | null;
};

export type InboundChatMessage = {
  surface: ChatSurfaceId;
  /** Workspace/account identifier for the surface (e.g. Slack team id). */
  accountId: string;
  /** Conversation identifier for the surface (e.g. Slack channel id). */
  conversationId: string;
  /** Thread identifier, if the surface supports threads. */
  threadId?: string | null;
  /** Sender/user identifier on the surface. */
  senderId: string;
  /** Raw user-visible text. */
  text: string;
  /** Surface event timestamp (string is surface-native). */
  ts: string;

  /** Resolved Orchest identifiers (transport adapters are responsible for resolving these). */
  clientId: string;
  agentId: string;

  /**
   * Optional routing hints from the transport adapter.
   * Example: Slack app_mention vs DM vs subscribed-thread reply.
   */
  kind?: "dm" | "mention" | "thread_reply" | "message";
  addressedToAgent?: boolean;

  /** Surface-specific context that may help tools (keep small). */
  context?: Record<string, string | number | boolean | null | undefined>;
};

export type ChatTransport = {
  surface: ChatSurfaceId;

  postMessage: (input: {
    conversationId: string;
    threadId?: string | null;
    text: string;
    author?: ChatAuthor;
  }) => Promise<void>;

  /**
   * Post a progress update. Transport may format differently than normal text
   * (e.g., italics, ephemeral messages, etc.).
   */
  postProgress: (input: {
    conversationId: string;
    threadId?: string | null;
    text: string;
    author?: ChatAuthor;
    /** When true, this is a one-time header for subsequent progress updates. */
    isHeader?: boolean;
  }) => Promise<void>;

  /**
   * Optional: fetch short thread context as a string to append to task input.
   * Should be concise and safe (no tokens/secrets).
   */
  fetchThreadContext?: (input: {
    conversationId: string;
    threadId: string;
    maxMessages?: number;
    /** If true, only return messages that belong to the specified thread. */
    strictThreadOnly?: boolean;
  }) => Promise<string>;
};

