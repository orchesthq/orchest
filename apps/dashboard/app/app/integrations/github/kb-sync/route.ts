import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";
import { getClientIdFromSession } from "@/lib/session";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);
  if (!clientId) return NextResponse.redirect(new URL("/sign-in", origin), 303);

  const form = await req.formData();
  const repoFullName = String(form.get("repoFullName") ?? "").trim();
  const ref = String(form.get("ref") ?? "main").trim() || "main";
  const after = String(form.get("returnTo") ?? "/app/integrations/github") || "/app/integrations/github";

  if (!repoFullName) {
    const target = new URL("/app/integrations/github", origin);
    target.searchParams.set("kb_error", "kb_sync_missing_repo");
    target.searchParams.set("returnTo", after);
    return NextResponse.redirect(target, 303);
  }

  try {
    await apiFetchForClient(clientId, "/internal/kb/sync/github", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoFullName, ref, maxFiles: 200 }),
    });
  } catch (err) {
    console.error("[kb] github sync failed", err);
    const target = new URL("/app/integrations/github", origin);
    target.searchParams.set("kb_error", "kb_sync_failed");
    target.searchParams.set("repo", repoFullName);
    target.searchParams.set("returnTo", after);
    return NextResponse.redirect(target, 303);
  }

  const target = new URL("/app/integrations/github", origin);
  target.searchParams.set("kb", "synced");
  target.searchParams.set("repo", repoFullName);
  target.searchParams.set("returnTo", after);
  return NextResponse.redirect(target, 303);
}

