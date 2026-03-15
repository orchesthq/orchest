import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";
import { getClientIdFromSession } from "@/lib/session";

type Agent = { id: string; name: string };

type UsageSummary = {
  totals: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    billableUsdMicros: number;
  };
  groups: Array<{
    key: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    billableUsdMicros: number;
  }>;
};

type UsageEvent = {
  id: string;
  task_id: string | null;
  agent_id: string | null;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cached_prompt_tokens: number;
  total_tokens: number;
  occurred_at: string;
};

type BillingBalance = {
  balanceUsdMicros: number;
  monthSpendUsdMicros: number;
  monthCreditsUsdMicros: number;
  monthlyBudgetUsdMicros: number | null;
  monthUsagePercent: number | null;
};

type UsageFilterOptions = {
  providers: string[];
  modelGroups: string[];
};

type DateRangePreset = "mtd" | "last7d" | "last14d" | "last30d" | "custom";
type ChartDayBucket = {
  day: string;
  totalTokens: number;
  segments: Array<{ agentId: string; tokens: number }>;
};

function percentLabel(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "No budget";
  return `${Math.max(0, pct).toFixed(1)}%`;
}

function toYmd(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysAgoUtc(base: Date, days: number): Date {
  const x = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - days);
  return x;
}

function getPresetRange(preset: DateRangePreset): { fromYmd: string; toYmd: string } {
  const now = new Date();
  const todayYmd = toYmd(now);
  if (preset === "last7d") {
    return { fromYmd: toYmd(daysAgoUtc(now, 6)), toYmd: todayYmd };
  }
  if (preset === "last14d") {
    return { fromYmd: toYmd(daysAgoUtc(now, 13)), toYmd: todayYmd };
  }
  if (preset === "last30d") {
    return { fromYmd: toYmd(daysAgoUtc(now, 29)), toYmd: todayYmd };
  }
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { fromYmd: toYmd(firstOfMonth), toYmd: todayYmd };
}

function chartLabelFromDay(dayKey: string): string {
  if (dayKey.length >= 10) return dayKey.slice(5);
  return dayKey;
}

function listDaysInclusive(fromYmd: string, throughYmd: string): string[] {
  const out: string[] = [];
  const start = new Date(`${fromYmd}T00:00:00.000Z`);
  const end = new Date(`${throughYmd}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return out;
  const cur = new Date(start);
  while (cur <= end) {
    out.push(toYmd(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function formatCompactTokens(n: number): string {
  const v = Math.max(0, Number(n) || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(Math.round(v));
}

function colorForIndex(i: number): string {
  const palette = [
    "#7C3AED",
    "#06B6D4",
    "#F59E0B",
    "#10B981",
    "#EF4444",
    "#6366F1",
    "#84CC16",
    "#EC4899",
    "#14B8A6",
    "#F97316",
  ];
  return palette[i % palette.length];
}

function mapModelToGroup(model: string, modelGroups: string[]): string {
  const m = String(model ?? "").trim();
  if (!m) return m;
  const candidates = modelGroups
    .filter((g) => m === g || m.startsWith(`${g}-`))
    .sort((a, b) => b.length - a.length);
  return candidates[0] ?? m;
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);
  if (!clientId) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-900">No client assigned</h1>
      </div>
    );
  }

  const sp = await searchParams;
  const get = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const from = get("from") ?? "";
  const to = get("to") ?? "";
  const agentId = get("agentId") ?? "";
  const modelGroup = get("modelGroup") ?? "";
  const provider = get("provider") ?? "";
  const rawRange = get("range");
  const range: DateRangePreset =
    rawRange === "last7d" || rawRange === "last14d" || rawRange === "last30d" || rawRange === "custom"
      ? rawRange
      : "mtd";
  const usePreset = range !== "custom";
  const presetRange = getPresetRange(range);
  const effectiveFrom = usePreset ? presetRange.fromYmd : from;
  const effectiveTo = usePreset ? presetRange.toYmd : to;

  const q = new URLSearchParams();
  if (effectiveFrom) q.set("from", `${effectiveFrom}T00:00:00.000Z`);
  if (effectiveTo) q.set("to", `${effectiveTo}T23:59:59.999Z`);
  if (agentId) q.set("agentId", agentId);
  if (modelGroup) q.set("modelGroup", modelGroup);
  if (provider) q.set("provider", provider);

  const [agentsResp, summary, chartSummary, eventsResp, billing, filterOptions] = await Promise.all([
    apiFetchForClient<{ agents: Agent[] }>(clientId, "/agents", { method: "GET" }).catch(() => ({ agents: [] })),
    apiFetchForClient<UsageSummary>(clientId, `/usage/summary?groupBy=day&${q.toString()}`, {
      method: "GET",
    }).catch(() => ({
      totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, billableUsdMicros: 0 },
      groups: [],
    })),
    apiFetchForClient<UsageSummary>(clientId, `/usage/summary?groupBy=day_agent&${q.toString()}`, {
      method: "GET",
    }).catch(() => ({
      totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, billableUsdMicros: 0 },
      groups: [],
    })),
    apiFetchForClient<{ events: UsageEvent[] }>(clientId, `/usage/events?limit=100&${q.toString()}`, {
      method: "GET",
    }).catch(() => ({ events: [] })),
    apiFetchForClient<BillingBalance>(clientId, "/billing/balance", { method: "GET" }).catch(() => ({
      balanceUsdMicros: 0,
      monthSpendUsdMicros: 0,
      monthCreditsUsdMicros: 0,
      monthlyBudgetUsdMicros: null,
      monthUsagePercent: null,
    })),
    apiFetchForClient<UsageFilterOptions>(clientId, "/usage/filter-options", { method: "GET" }).catch(() => ({
      providers: ["openai_compatible"],
      modelGroups: ["gpt-5.3", "gpt-5.2", "gpt-5.1", "gpt-5-mini", "gpt-5-nano", "gpt-5"],
    })),
  ]);

  const agents = agentsResp.agents ?? [];
  const providers = filterOptions.providers ?? ["openai_compatible"];
  const modelGroups = filterOptions.modelGroups ?? ["gpt-5.3", "gpt-5.2", "gpt-5.1", "gpt-5-mini", "gpt-5-nano", "gpt-5"];
  const events = eventsResp.events ?? [];
  const agentNameById = new Map(agents.map((a) => [a.id, a.name] as const));
  const daysInRange = listDaysInclusive(effectiveFrom, effectiveTo);
  const chartMap = new Map<string, Map<string, number>>();
  for (const g of chartSummary.groups) {
    const [day, agent] = String(g.key).split("|");
    if (!day || !agent) continue;
    const byAgent = chartMap.get(day) ?? new Map<string, number>();
    byAgent.set(agent, (byAgent.get(agent) ?? 0) + g.totalTokens);
    chartMap.set(day, byAgent);
  }
  const chartBuckets: ChartDayBucket[] = daysInRange.map((day) => {
    const byAgent = chartMap.get(day) ?? new Map<string, number>();
    const segments = Array.from(byAgent.entries())
      .map(([agentId, tokens]) => ({ agentId, tokens }))
      .sort((a, b) => b.tokens - a.tokens);
    const totalTokens = segments.reduce((acc, s) => acc + s.tokens, 0);
    return { day, totalTokens, segments };
  });
  const maxChartTokens = Math.max(1, ...chartBuckets.map((b) => b.totalTokens));
  const allAgentIdsInChart = Array.from(
    new Set(chartBuckets.flatMap((b) => b.segments.map((s) => s.agentId)))
  ).sort((a, b) => {
    const aName = a === "none" ? "Unassigned" : (agentNameById.get(a) ?? a);
    const bName = b === "none" ? "Unassigned" : (agentNameById.get(b) ?? b);
    return aName.localeCompare(bName);
  });
  const agentColor = new Map(allAgentIdsInChart.map((id, idx) => [id, colorForIndex(idx)] as const));
  const yTickRatios = [1, 0.75, 0.5, 0.25, 0];

  const groupedByTask = new Map<
    string,
    {
      taskId: string | null;
      startedAt: string;
      endedAt: string;
      agentId: string | null;
      models: Set<string>;
      promptTokens: number;
      completionTokens: number;
      cachedPromptTokens: number;
      totalTokens: number;
      calls: number;
    }
  >();
  for (const e of events) {
    const key = e.task_id ?? `interaction:${e.id}`;
    const existing = groupedByTask.get(key);
    if (!existing) {
      groupedByTask.set(key, {
        taskId: e.task_id,
        startedAt: e.occurred_at,
        endedAt: e.occurred_at,
        agentId: e.agent_id,
        models: new Set([mapModelToGroup(e.model, modelGroups)]),
        promptTokens: e.prompt_tokens,
        completionTokens: e.completion_tokens,
        cachedPromptTokens: e.cached_prompt_tokens ?? 0,
        totalTokens: e.total_tokens,
        calls: 1,
      });
      continue;
    }
    existing.startedAt = existing.startedAt < e.occurred_at ? existing.startedAt : e.occurred_at;
    existing.endedAt = existing.endedAt > e.occurred_at ? existing.endedAt : e.occurred_at;
    existing.agentId = existing.agentId ?? e.agent_id;
    existing.models.add(mapModelToGroup(e.model, modelGroups));
    existing.promptTokens += e.prompt_tokens;
    existing.completionTokens += e.completion_tokens;
    existing.cachedPromptTokens += e.cached_prompt_tokens ?? 0;
    existing.totalTokens += e.total_tokens;
    existing.calls += 1;
  }
  const taskRows = Array.from(groupedByTask.values()).sort((a, b) => (a.endedAt < b.endedAt ? 1 : -1));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Usage</h1>
        <p className="mt-1 text-sm text-zinc-600">Track usage by period, model group, and agent.</p>
      </div>

      <form className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm md:grid-cols-6">
        <input
          type="date"
          name="from"
          defaultValue={effectiveFrom}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        <input
          type="date"
          name="to"
          defaultValue={effectiveTo}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        <select name="agentId" defaultValue={agentId} className="rounded-md border border-zinc-300 px-3 py-2 text-sm">
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select name="provider" defaultValue={provider} className="rounded-md border border-zinc-300 px-3 py-2 text-sm">
          <option value="">All providers</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select name="modelGroup" defaultValue={modelGroup} className="rounded-md border border-zinc-300 px-3 py-2 text-sm">
          <option value="">All model groups</option>
          {modelGroups.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2 md:col-span-6">
          <button
            name="range"
            value="mtd"
            className={`rounded-full border px-3 py-1.5 text-sm ${
              range === "mtd" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700"
            }`}
          >
            Month to date
          </button>
          <button
            name="range"
            value="last7d"
            className={`rounded-full border px-3 py-1.5 text-sm ${
              range === "last7d" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700"
            }`}
          >
            Last 7 days
          </button>
          <button
            name="range"
            value="last14d"
            className={`rounded-full border px-3 py-1.5 text-sm ${
              range === "last14d" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700"
            }`}
          >
            Last 14 days
          </button>
          <button
            name="range"
            value="last30d"
            className={`rounded-full border px-3 py-1.5 text-sm ${
              range === "last30d" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700"
            }`}
          >
            Last 30 days
          </button>
          <button
            name="range"
            value="custom"
            className={`rounded-full border px-3 py-1.5 text-sm ${
              range === "custom" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700"
            }`}
          >
            Custom range
          </button>
          <button
            name="range"
            value={range}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Apply filters
          </button>
        </div>
      </form>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card label="Prompt tokens" value={summary.totals.promptTokens.toLocaleString()} />
        <Card label="Completion tokens" value={summary.totals.completionTokens.toLocaleString()} />
        <Card label="Total tokens" value={summary.totals.totalTokens.toLocaleString()} />
        <Card label="Monthly budget used" value={percentLabel(billing.monthUsagePercent)} />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-zinc-900">Daily token usage</h2>
        <p className="mb-3 text-xs text-zinc-500">Updates with the current filters.</p>
        {allAgentIdsInChart.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
            {allAgentIdsInChart.map((agentKey) => (
              <div key={agentKey} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: agentColor.get(agentKey) ?? "#7C3AED" }}
                />
                <span>{agentKey === "none" ? "Unassigned" : (agentNameById.get(agentKey) ?? agentKey)}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
          <div className="grid grid-cols-[56px_1fr] gap-2">
            <div className="relative h-56">
              {yTickRatios.map((ratio) => (
                <div
                  key={ratio}
                  className="absolute right-0 text-[10px] text-zinc-500"
                  style={{ top: `${(1 - ratio) * 100}%`, transform: "translateY(-50%)" }}
                >
                  {formatCompactTokens(Math.round(maxChartTokens * ratio))}
                </div>
              ))}
            </div>
            <div className="relative h-56">
              {yTickRatios.map((ratio) => (
                <div
                  key={`line-${ratio}`}
                  className="absolute left-0 right-0 border-t border-zinc-200/70"
                  style={{ top: `${(1 - ratio) * 100}%` }}
                />
              ))}
              {chartBuckets.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">
                  No chart data for selected filters.
                </div>
              ) : (
                <div className="relative z-10 flex h-full items-end gap-1">
                  {chartBuckets.map((bucket, idx) => (
                    <div key={bucket.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                      <div className="relative w-full overflow-hidden rounded-sm">
                        {bucket.segments.length === 0 ? (
                          <div className="h-px w-full bg-zinc-200" />
                        ) : (
                          <div className="flex w-full flex-col-reverse">
                            {bucket.segments.map((seg) => {
                              const segHeight = (seg.tokens / maxChartTokens) * 100;
                              const agentLabel =
                                seg.agentId === "none" ? "Unassigned" : (agentNameById.get(seg.agentId) ?? seg.agentId);
                              return (
                                <div
                                  key={`${bucket.day}:${seg.agentId}`}
                                  className="w-full"
                                  style={{
                                    height: `${segHeight}%`,
                                    backgroundColor: agentColor.get(seg.agentId) ?? "#7C3AED",
                                  }}
                                  title={`${bucket.day} • ${agentLabel}: ${seg.tokens.toLocaleString()} tokens`}
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className="max-w-full truncate text-[10px] text-zinc-500">
                        {idx === 0 || idx === chartBuckets.length - 1 || idx % 3 === 0 ? chartLabelFromDay(bucket.day) : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900">Usage by task</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="px-2 py-2">Task</th>
                <th className="px-2 py-2">When</th>
                <th className="px-2 py-2">Agent</th>
                <th className="px-2 py-2">Model(s)</th>
                <th className="px-2 py-2">Calls</th>
                <th className="px-2 py-2">Total tokens</th>
              </tr>
            </thead>
            <tbody>
              {taskRows.map((t) => (
                <tr key={t.taskId ?? `${t.startedAt}:${t.calls}`} className="border-t border-zinc-100">
                  <td className="px-2 py-2 font-mono text-xs text-zinc-600">{t.taskId ?? "interaction"}</td>
                  <td className="px-2 py-2">{new Date(t.endedAt).toLocaleString()}</td>
                  <td className="px-2 py-2">{t.agentId ? (agentNameById.get(t.agentId) ?? t.agentId) : "-"}</td>
                  <td className="px-2 py-2">{Array.from(t.models).join(", ")}</td>
                  <td className="px-2 py-2">{t.calls.toLocaleString()}</td>
                  <td className="px-2 py-2">{t.totalTokens.toLocaleString()}</td>
                </tr>
              ))}
              {taskRows.length === 0 ? (
                <tr>
                  <td className="px-2 py-4 text-zinc-500" colSpan={6}>
                    No usage found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-zinc-900">{value}</div>
    </div>
  );
}
