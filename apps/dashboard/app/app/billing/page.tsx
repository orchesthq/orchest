import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";
import { getClientIdFromSession } from "@/lib/session";

type LedgerEntry = {
  id: string;
  entry_type: string;
  tokens: number;
  note: string | null;
  created_at: string;
  metadata: unknown;
};

type PricingRate = {
  id: string;
  provider: string;
  model: string;
  operation: string;
  token_type: "input" | "output";
  usd_per_1m_tokens: string;
  pricing_version: string;
  effective_from: string;
  active: boolean;
};

function moneyFromMicros(micros: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((micros || 0) / 1_000_000);
}

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:3000";
}

function internalSecret(): string {
  const s = process.env.INTERNAL_SERVICE_SECRET;
  if (!s) throw new Error("INTERNAL_SERVICE_SECRET is not configured for dashboard");
  return s;
}

export default async function BillingPage({
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

  const [balance, ledgerResp, profileResp, pricingResp] = await Promise.all([
    apiFetchForClient<{ balanceUsdMicros: number; monthSpendUsdMicros: number; monthCreditsUsdMicros: number }>(
      clientId,
      "/billing/balance",
      { method: "GET" }
    ).catch(() => ({ balanceUsdMicros: 0, monthSpendUsdMicros: 0, monthCreditsUsdMicros: 0 })),
    apiFetchForClient<{ entries: LedgerEntry[] }>(clientId, "/billing/ledger?limit=100", {
      method: "GET",
    }).catch(() => ({ entries: [] })),
    apiFetchForClient<{ profile: { markupMultiplier: number; freeMonthlyUsdMicros: number } }>(
      clientId,
      "/admin/billing/profile",
      { method: "GET" }
    ).catch(() => ({ profile: { markupMultiplier: 1, freeMonthlyUsdMicros: 0 } })),
    fetch(`${apiBaseUrl()}/admin/pricing/rates?limit=200`, {
      method: "GET",
      headers: { "x-internal-secret": internalSecret() },
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) return { rates: [] as PricingRate[] };
        return (await r.json()) as { rates: PricingRate[] };
      })
      .catch(() => ({ rates: [] as PricingRate[] })),
  ]);

  const sp = await searchParams;
  const adminSaved = Array.isArray(sp.adminSaved) ? sp.adminSaved[0] : sp.adminSaved;
  const adminError = Array.isArray(sp.adminError) ? sp.adminError[0] : sp.adminError;
  const entries = ledgerResp.entries ?? [];
  const rates = pricingResp.rates ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Billing</h1>
        <p className="mt-1 text-sm text-zinc-600">Simple USD credits billing with full per-model internal accounting.</p>
      </div>

      {adminSaved ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Saved: {adminSaved}
        </div>
      ) : null}
      {adminError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Could not save admin action: {adminError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label="Credits balance" value={moneyFromMicros(balance.balanceUsdMicros)} />
        <StatCard label="This month spend" value={moneyFromMicros(balance.monthSpendUsdMicros)} />
        <StatCard label="This month credits" value={moneyFromMicros(balance.monthCreditsUsdMicros)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AdminForm title="Grant credits" action="/api/billing/admin/grant">
          <input name="usd" type="number" step="0.01" min="0" placeholder="USD amount" className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
          <input name="note" placeholder="Note (optional)" className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
        </AdminForm>

        <AdminForm title="Adjust credits" action="/api/billing/admin/adjust">
          <input name="usd" type="number" step="0.01" placeholder="Positive or negative USD" className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
          <input name="note" placeholder="Note (optional)" className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
        </AdminForm>

        <AdminForm title="Billing profile" action="/api/billing/admin/profile">
          <input
            name="markupMultiplier"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={Number(profileResp.profile.markupMultiplier).toFixed(2)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          <input
            name="freeMonthlyUsd"
            type="number"
            step="0.01"
            min="0"
            defaultValue={(Number(profileResp.profile.freeMonthlyUsdMicros) / 1_000_000).toFixed(2)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </AdminForm>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900">Rate card</h2>
        <form action="/api/pricing/rates" method="post" className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-6">
          <input name="provider" placeholder="provider" className="rounded-md border border-zinc-300 px-3 py-2 text-sm" required />
          <input name="model" placeholder="model or *" className="rounded-md border border-zinc-300 px-3 py-2 text-sm" required />
          <input name="operation" placeholder="operation" defaultValue="chat.completion.react" className="rounded-md border border-zinc-300 px-3 py-2 text-sm" required />
          <input name="inputUsdPer1m" type="number" step="0.000001" min="0" placeholder="input USD / 1M" className="rounded-md border border-zinc-300 px-3 py-2 text-sm" required />
          <input name="outputUsdPer1m" type="number" step="0.000001" min="0" placeholder="output USD / 1M" className="rounded-md border border-zinc-300 px-3 py-2 text-sm" required />
          <input name="pricingVersion" placeholder="version" defaultValue="v1" className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
          <div className="md:col-span-6">
            <button className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">Add rates</button>
          </div>
        </form>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="px-2 py-2">Provider</th>
                <th className="px-2 py-2">Model</th>
                <th className="px-2 py-2">Operation</th>
                <th className="px-2 py-2">Token type</th>
                <th className="px-2 py-2">USD / 1M</th>
                <th className="px-2 py-2">Version</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id} className="border-t border-zinc-100">
                  <td className="px-2 py-2">{r.provider}</td>
                  <td className="px-2 py-2">{r.model}</td>
                  <td className="px-2 py-2">{r.operation}</td>
                  <td className="px-2 py-2">{r.token_type}</td>
                  <td className="px-2 py-2">
                    {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(
                      Number(r.usd_per_1m_tokens) / 1_000_000
                    )}
                  </td>
                  <td className="px-2 py-2">{r.pricing_version}</td>
                </tr>
              ))}
              {rates.length === 0 ? (
                <tr>
                  <td className="px-2 py-4 text-zinc-500" colSpan={6}>
                    No rates configured yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900">Ledger</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="px-2 py-2">When</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Amount</th>
                <th className="px-2 py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-zinc-100">
                  <td className="px-2 py-2">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="px-2 py-2">{e.entry_type}</td>
                  <td className="px-2 py-2">{moneyFromMicros(e.tokens)}</td>
                  <td className="px-2 py-2">{e.note ?? "-"}</td>
                </tr>
              ))}
              {entries.length === 0 ? (
                <tr>
                  <td className="px-2 py-4 text-zinc-500" colSpan={4}>
                    No ledger entries yet.
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-900">{value}</div>
    </div>
  );
}

function AdminForm({
  title,
  action,
  children,
}: {
  title: string;
  action: string;
  children: React.ReactNode;
}) {
  return (
    <form action={action} method="post" className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900">{title}</h2>
      <div className="space-y-2">{children}</div>
      <button className="mt-3 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">Save</button>
    </form>
  );
}
