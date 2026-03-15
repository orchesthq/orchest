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
  operation: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  billable_usd_micros: number | null;
  occurred_at: string;
};

function moneyFromMicros(micros: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((micros || 0) / 1_000_000);
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
  const model = get("model") ?? "";
  const provider = get("provider") ?? "";
  const operation = get("operation") ?? "";

  const q = new URLSearchParams();
  if (from) q.set("from", `${from}T00:00:00.000Z`);
  if (to) q.set("to", `${to}T23:59:59.999Z`);
  if (agentId) q.set("agentId", agentId);
  if (model) q.set("model", model);
  if (provider) q.set("provider", provider);
  if (operation) q.set("operation", operation);

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Usage</h1>
        <p className="mt-1 text-sm text-zinc-600">Track usage by day, model, and operation.</p>
      </div>

      <form className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm md:grid-cols-6">
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
        <input name="operation" placeholder="Operation" defaultValue={operation} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
        <div className="md:col-span-6">
          <button className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">Apply filters</button>
        </div>
      </form>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card label="Prompt tokens" value={summary.totals.promptTokens.toLocaleString()} />
        <Card label="Completion tokens" value={summary.totals.completionTokens.toLocaleString()} />
        <Card label="Total tokens" value={summary.totals.totalTokens.toLocaleString()} />
        <Card label="Billable" value={moneyFromMicros(summary.totals.billableUsdMicros)} />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900">Daily usage</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="px-2 py-2">Day</th>
                <th className="px-2 py-2">Total tokens</th>
                <th className="px-2 py-2">Billable</th>
              </tr>
            </thead>
            <tbody>
              {summary.groups.map((g) => (
                <tr key={g.key} className="border-t border-zinc-100">
                  <td className="px-2 py-2">{g.key}</td>
                  <td className="px-2 py-2">{g.totalTokens.toLocaleString()}</td>
                  <td className="px-2 py-2">{moneyFromMicros(g.billableUsdMicros)}</td>
                </tr>
              ))}
              {summary.groups.length === 0 ? (
                <tr>
                  <td className="px-2 py-4 text-zinc-500" colSpan={3}>
                    No usage for the selected filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900">Usage events</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="px-2 py-2">When</th>
                <th className="px-2 py-2">Model</th>
                <th className="px-2 py-2">Operation</th>
                <th className="px-2 py-2">Tokens</th>
                <th className="px-2 py-2">Billable</th>
                <th className="px-2 py-2">Task</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-zinc-100">
                  <td className="px-2 py-2">{new Date(e.occurred_at).toLocaleString()}</td>
                  <td className="px-2 py-2">{e.model}</td>
                  <td className="px-2 py-2">{e.operation}</td>
                  <td className="px-2 py-2">{e.total_tokens.toLocaleString()}</td>
                  <td className="px-2 py-2">{moneyFromMicros(e.billable_usd_micros ?? 0)}</td>
                  <td className="px-2 py-2 font-mono text-xs text-zinc-600">{e.task_id ?? "-"}</td>
                </tr>
              ))}
              {events.length === 0 ? (
                <tr>
                  <td className="px-2 py-4 text-zinc-500" colSpan={6}>
                    No events found.
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
