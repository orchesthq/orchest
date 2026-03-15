import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";
import { getClientIdFromSession } from "@/lib/session";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const markupMultiplier = Number(String(form.get("markupMultiplier") ?? "1"));
  const freeMonthlyUsd = Number(String(form.get("freeMonthlyUsd") ?? "0"));
  if (!Number.isFinite(markupMultiplier) || markupMultiplier <= 0 || !Number.isFinite(freeMonthlyUsd) || freeMonthlyUsd < 0) {
    return NextResponse.redirect(new URL("/app/billing?adminError=invalid_profile", req.url), 303);
  }

  await apiFetchForClient(clientId, "/admin/billing/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      markupMultiplier,
      freeMonthlyUsdMicros: Math.round(freeMonthlyUsd * 1_000_000),
    }),
  });
  return NextResponse.redirect(new URL("/app/billing?adminSaved=profile", req.url), 303);
}
