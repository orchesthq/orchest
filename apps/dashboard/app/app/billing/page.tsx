import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";
import { getClientIdFromSession } from "@/lib/session";

function moneyFromMicros(micros: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((micros || 0) / 1_000_000);
}

export default async function BillingPage() {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);
  if (!clientId) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-900">No client assigned</h1>
      </div>
    );
  }

  const balance = await apiFetchForClient<{
    balanceUsdMicros: number;
    monthSpendUsdMicros: number;
    monthCreditsUsdMicros: number;
  }>(clientId, "/billing/balance", {
    method: "GET",
  }).catch(() => ({ balanceUsdMicros: 0, monthSpendUsdMicros: 0, monthCreditsUsdMicros: 0 }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Billing</h1>
        <p className="mt-1 text-sm text-zinc-600">Simple USD credits billing with full per-model internal accounting.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label="Credits balance" value={moneyFromMicros(balance.balanceUsdMicros)} />
        <StatCard label="This month spend" value={moneyFromMicros(balance.monthSpendUsdMicros)} />
        <StatCard label="This month credits" value={moneyFromMicros(balance.monthCreditsUsdMicros)} />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 shadow-sm">
        Credits, top-ups, and rate-card changes are managed by Orchest admins for now. Reach out to support if you need an adjustment.
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 shadow-sm">
        Billing history, invoices, and top-up options will appear here soon.
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
