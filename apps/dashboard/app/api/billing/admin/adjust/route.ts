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
  const usd = Number(String(form.get("usd") ?? "0"));
  const note = String(form.get("note") ?? "").trim();
  const usdMicros = Math.round(usd * 1_000_000);
  if (!Number.isFinite(usdMicros) || usdMicros === 0) {
    return NextResponse.redirect(new URL("/app/billing?adminError=invalid_adjust_amount", req.url), 303);
  }

  await apiFetchForClient(clientId, "/admin/billing/adjust-credits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usdMicros, note: note || undefined }),
  });
  return NextResponse.redirect(new URL("/app/billing?adminSaved=adjust", req.url), 303);
}
