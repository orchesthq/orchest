import {
  getClientBillingProfileOrDefault,
  insertTokenLedgerEntry,
  insertTokenUsageEvent,
  resolveLlmPricingForUsage,
  updateTokenUsageEventPricing,
} from "../db/schema";

export type LlmUsageContext = {
  clientId: string;
  agentId?: string;
  taskId?: string;
  model?: string;
  operation: string;
  metadata?: Record<string, unknown>;
};

export async function persistLlmUsageAndBilling(input: {
  provider: string;
  operation: string;
  requestBody: any;
  responseBody: any;
  usageContext?: LlmUsageContext;
}): Promise<void> {
  const usage = input.responseBody?.usage;
  const ctx = input.usageContext;
  if (!usage || !ctx?.clientId) return;

  const promptTokens = toNonNegativeInt(usage?.prompt_tokens);
  const completionTokens = toNonNegativeInt(usage?.completion_tokens);
  if (promptTokens + completionTokens <= 0) return;

  const cachedPromptTokens = toNonNegativeInt(
    usage?.prompt_tokens_details?.cached_tokens ?? usage?.input_tokens_details?.cached_tokens
  );
  const reasoningTokens = toNonNegativeInt(
    usage?.completion_tokens_details?.reasoning_tokens ?? usage?.output_tokens_details?.reasoning_tokens
  );

  const model = String(input.responseBody?.model ?? input.requestBody?.model ?? "").trim();
  if (!model) return;

  try {
    const usageEvent = await insertTokenUsageEvent({
      clientId: ctx.clientId,
      agentId: ctx.agentId,
      taskId: ctx.taskId,
      provider: input.provider,
      model,
      operation: input.operation,
      promptTokens,
      completionTokens,
      cachedPromptTokens,
      reasoningTokens,
      providerRequestId:
        typeof input.responseBody?.id === "string" && input.responseBody.id.trim()
          ? input.responseBody.id.trim()
          : null,
      metadata: {
        ...(ctx.metadata ?? {}),
        finishReason: input.responseBody?.choices?.[0]?.finish_reason ?? null,
      },
    });

    const billing = await getClientBillingProfileOrDefault(ctx.clientId);
    const pricing = await resolveLlmPricingForUsage({
      provider: usageEvent.provider,
      model: usageEvent.model,
      operation: usageEvent.operation,
      occurredAt: new Date(usageEvent.occurred_at),
    });

    const cachedPromptTokensForPricing = Math.min(
      Math.max(0, Number(usageEvent.cached_prompt_tokens) || 0),
      Math.max(0, Number(usageEvent.prompt_tokens) || 0)
    );
    const nonCachedPromptTokens = Math.max(
      0,
      (Number(usageEvent.prompt_tokens) || 0) - cachedPromptTokensForPricing
    );

    const inputCostUsdMicros = pricing
      ? microsFromTokens(pricing.inputUsdPer1mTokensMicros, nonCachedPromptTokens)
      : 0;
    const cachedInputCostUsdMicros = pricing
      ? microsFromTokens(pricing.cachedInputUsdPer1mTokensMicros, cachedPromptTokensForPricing)
      : 0;
    const outputCostUsdMicros = pricing
      ? microsFromTokens(pricing.outputUsdPer1mTokensMicros, usageEvent.completion_tokens)
      : 0;
    const totalCostUsdMicros = inputCostUsdMicros + cachedInputCostUsdMicros + outputCostUsdMicros;
    const billableUsdMicros = Math.max(
      0,
      Math.round(totalCostUsdMicros * Math.max(0, Number(billing.markupMultiplier) || 1))
    );

    await updateTokenUsageEventPricing({
      eventId: usageEvent.id,
      clientId: ctx.clientId,
      inputCostUsdMicros,
      cachedInputCostUsdMicros,
      outputCostUsdMicros,
      totalCostUsdMicros,
      markupMultiplierSnapshot: billing.markupMultiplier,
      billableUsdMicros,
      pricingVersion: pricing?.pricingVersion ?? "unpriced",
      pricingMissing: !pricing,
    });

    if (billableUsdMicros > 0) {
      await insertTokenLedgerEntry({
        clientId: ctx.clientId,
        entryType: "usage_debit",
        tokens: -billableUsdMicros,
        referenceType: "token_usage_event",
        referenceId: usageEvent.id,
        metadata: {
          provider: usageEvent.provider,
          model: usageEvent.model,
          operation: usageEvent.operation,
          totalTokens: usageEvent.total_tokens,
          billableUsdMicros,
          pricingVersion: pricing?.pricingVersion ?? "unpriced",
        },
      });
    }
  } catch (err) {
    console.error("[llmUsageBilling] failed to persist usage/billing", err);
  }
}

function toNonNegativeInt(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function microsFromTokens(usdPer1mTokensMicros: number, tokens: number): number {
  const priceMicros = Math.max(0, Number(usdPer1mTokensMicros) || 0);
  const count = Math.max(0, Number(tokens) || 0);
  if (priceMicros === 0 || count === 0) return 0;
  return Math.round((priceMicros * count) / 1_000_000);
}
