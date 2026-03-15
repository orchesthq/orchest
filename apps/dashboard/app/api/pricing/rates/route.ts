import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:3000";
}

function internalSecret(): string {
  const s = process.env.INTERNAL_SERVICE_SECRET;
  if (!s) throw new Error("INTERNAL_SERVICE_SECRET is not configured for dashboard");
  return s;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!(session as any)?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const provider = String(form.get("provider") ?? "").trim();
  const model = String(form.get("model") ?? "").trim();
  const operation = String(form.get("operation") ?? "").trim();
  const inputUsdPer1m = Number(String(form.get("inputUsdPer1m") ?? "0"));
  const outputUsdPer1m = Number(String(form.get("outputUsdPer1m") ?? "0"));
  const pricingVersion = String(form.get("pricingVersion") ?? "v1").trim() || "v1";

  if (!provider || !model || !operation || !Number.isFinite(inputUsdPer1m) || !Number.isFinite(outputUsdPer1m)) {
    return NextResponse.redirect(new URL("/app/billing?adminError=invalid_rate", req.url), 303);
  }

  const headers = {
    "Content-Type": "application/json",
    "x-internal-secret": internalSecret(),
  };
  const base = apiBaseUrl();

  for (const tokenType of ["input", "output"] as const) {
    const usd = tokenType === "input" ? inputUsdPer1m : outputUsdPer1m;
    const res = await fetch(`${base}/admin/pricing/rates`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider,
        model,
        operation,
        tokenType,
        usdPer1mTokensMicros: Math.round(Math.max(0, usd) * 1_000_000),
        pricingVersion,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.redirect(new URL("/app/billing?adminError=rate_save_failed", req.url), 303);
    }
  }

  return NextResponse.redirect(new URL("/app/billing?adminSaved=rate", req.url), 303);
}
