import { z } from "zod";
import { isDbConfigured } from "../../db/client";
import { getClientAvailableBalanceUsdMicros, getPartnerSetting } from "../../db/schema";
import { persistLlmUsageAndBilling } from "../llmUsageBillingService";
import { LlmClient, type TokenUsageContext } from "./llmClient";

type OpenAiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

const openAiPartnerSettingsSchema = z
  .object({
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
  })
  .passthrough();

const OPENAI_SETTINGS_CACHE_TTL_MS = 30_000;
const INSUFFICIENT_BALANCE_MESSAGE =
  "Your Orchest usage budget is depleted. Please top up your Orchest account to continue.";
let openAiConfigCache:
  | {
      loadedAtMs: number;
      config: OpenAiConfig | null;
    }
  | undefined;

function normalizeBaseUrl(raw: string | undefined): string {
  return (raw ?? "https://api.openai.com/v1").replace(/\/+$/, "");
}

async function getOpenAiConfigFromDb(): Promise<OpenAiConfig | null> {
  const row = await getPartnerSetting({ partner: "openai", key: "default" });
  if (!row) return null;
  const parsed = openAiPartnerSettingsSchema.safeParse(row.settings ?? null);
  if (!parsed.success) return null;
  const apiKey = parsed.data.apiKey?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: normalizeBaseUrl(parsed.data.baseUrl),
    model: parsed.data.model ?? "gpt-4o-mini",
  };
}

export async function getOpenAiConfig(): Promise<OpenAiConfig | null> {
  const now = Date.now();
  if (openAiConfigCache && now - openAiConfigCache.loadedAtMs < OPENAI_SETTINGS_CACHE_TTL_MS) {
    return openAiConfigCache.config;
  }

  let config: OpenAiConfig | null = null;
  if (isDbConfigured()) {
    try {
      config = await getOpenAiConfigFromDb();
    } catch (err) {
      console.error("[openai] failed to load settings from DB", err);
    }
  }

  openAiConfigCache = { loadedAtMs: now, config };
  return config;
}

export class OpenAiClient extends LlmClient {
  readonly provider = "openai_compatible";
  readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(cfg: OpenAiConfig) {
    super();
    this.apiKey = cfg.apiKey;
    this.baseUrl = cfg.baseUrl;
    this.defaultModel = cfg.model;
  }

  private async assertClientCanUseLlm(usageContext?: TokenUsageContext): Promise<void> {
    if (!isDbConfigured()) return;
    const clientId = usageContext?.clientId;
    if (!clientId) return;
    const balanceUsdMicros = await getClientAvailableBalanceUsdMicros(clientId);
    if (balanceUsdMicros <= 0) {
      throw new InsufficientBalanceError();
    }
  }

  async chatCompletionRaw(body: any, usageContext?: TokenUsageContext): Promise<any> {
    await this.assertClientCanUseLlm(usageContext);
    const modelFromBody =
      typeof body?.model === "string" && body.model.trim().length > 0 ? body.model.trim() : null;
    const modelFromContext =
      typeof usageContext?.model === "string" && usageContext.model.trim().length > 0
        ? usageContext.model.trim()
        : null;
    const model = modelFromBody ?? modelFromContext ?? this.defaultModel;
    const url = `${this.baseUrl}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ temperature: 0.2, ...body, model }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI-compatible API error: ${res.status} ${res.statusText} ${text}`);
    }

    const json = (await res.json()) as any;
    await persistLlmUsageAndBilling({
      provider: this.provider,
      operation: usageContext?.operation ?? "chat.completion",
      requestBody: body,
      responseBody: json,
      usageContext,
    });
    return json;
  }

  async embeddingsRaw(body: any, usageContext?: TokenUsageContext): Promise<any> {
    await this.assertClientCanUseLlm(usageContext);
    const modelFromBody =
      typeof body?.model === "string" && body.model.trim().length > 0 ? body.model.trim() : null;
    const modelFromContext =
      typeof usageContext?.model === "string" && usageContext.model.trim().length > 0
        ? usageContext.model.trim()
        : null;
    const model = modelFromBody ?? modelFromContext ?? this.defaultModel;
    const url = `${this.baseUrl}/embeddings`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...body, model }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI-compatible embeddings error: ${res.status} ${res.statusText} ${text}`);
    }
    const json = (await res.json()) as any;
    await persistLlmUsageAndBilling({
      provider: this.provider,
      operation: usageContext?.operation ?? "embeddings.create",
      requestBody: body,
      responseBody: json,
      usageContext,
    });
    return json;
  }
}

export class InsufficientBalanceError extends Error {
  constructor(message = INSUFFICIENT_BALANCE_MESSAGE) {
    super(message);
    this.name = "InsufficientBalanceError";
  }
}

export async function createOpenAiClient(): Promise<OpenAiClient | null> {
  const cfg = await getOpenAiConfig();
  if (!cfg) return null;
  return new OpenAiClient(cfg);
}
