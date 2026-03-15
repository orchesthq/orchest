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
  const model = get("model") ?? "";
  const provider = get("provider") ?? "";

  const q = new URLSearchParams();
  if (from) q.set("from", `${from}T00:00:00.000Z`);
  if (to) q.set("to", `${to}T23:59:59.999Z`);
  if (agentId) q.set("agentId", agentId);
  if (model) q.set("model", model);
  if (provider) q.set("provider", provider);

  const [agentsResp, summary, eventsResp] = await Promise.all([
    apiFetchForClient<{ agents: Agent[] }>(clientId, "/agents", { method: "GET" }).catch(() => ({ agents: [] })),
    apiFetchForClient<UsageSummary>(clientId, `/usage/summary?groupBy=day&${q.toString()}`, {
      method: "GET",
    }).catch(() => ({
      totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, billableUsdMicros: 0 },
      groups: [],
    })),
    apiFetchForClient<{ events: UsageEvent[] }>(clientId, `/usage/events?limit=100&${q.toString()}`, {
      method: "GET",
    }).catch(() => ({ events: [] })),
  ]);

  const agents = agentsResp.agents ?? [];
  const events = eventsResp.events ?? [];
  const agentNameById = new Map(agents.map((a) => [a.id, a.name] as const));

  const maxDailyTokens = Math.max(1, ...summary.groups.map((g) => g.totalTokens));
  const dailySeries = summary.groups.slice(-14);

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
        models: new Set([e.model]),
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
    existing.models.add(e.model);
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
        <p className="mt-1 text-sm text-zinc-600">Track usage by day, model, and agent.</p>
      </div>

      <form className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm md:grid-cols-5">
        <input type="date" name="from" defaultValue={from} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
        <input type="date" name="to" defaultValue={to} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
        <select name="agentId" defaultValue={agentId} className="rounded-md border border-zinc-300 px-3 py-2 text-sm">
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input name="provider" placeholder="Provider" defaultValue={provider} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
        <input name="model" placeholder="Model" defaultValue={model} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
        <div className="md:col-span-5">
          <button className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">Apply filters</button>
        </div>
      </form>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card label="Prompt tokens" value={summary.totals.promptTokens.toLocaleString()} />
        <Card label="Completion tokens" value={summary.totals.completionTokens.toLocaleString()} />
        <Card label="Total tokens" value={summary.totals.totalTokens.toLocaleString()} />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-zinc-900">Daily token usage</h2>
        <p className="mb-3 text-xs text-zinc-500">Updates with the current filters.</p>
        <div className="h-44 rounded-xl border border-zinc-100 bg-zinc-50 p-3">
          <div className="flex h-full items-end gap-2">
            {dailySeries.map((d) => {
              const h = Math.max(6, Math.round((d.totalTokens / maxDailyTokens) * 100));
              return (
                <div key={d.key} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <div
                    className="w-full rounded-sm bg-violet-500/85"
                    style={{ height: `${h}%` }}
                    title={`${d.key}: ${d.totalTokens.toLocaleString()} tokens`}
                  />
                  <div className="text-[10px] text-zinc-500">{d.key.slice(5)}</div>
                </div>
              );
            })}
            {dailySeries.length === 0 ? (
              <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500">
                No daily usage for selected filters.
              </div>
            ) : null}
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
