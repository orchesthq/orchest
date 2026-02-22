import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";
import { getClientIdFromSession } from "@/lib/session";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);
  if (!clientId) {
    return NextResponse.redirect(new URL("/sign-in", process.env.NEXTAUTH_URL));
  }

  const after =
    new URL(req.url).searchParams.get("returnTo") ?? "/app/integrations/github";

  try {
    await apiFetchForClient(clientId, "/internal/github/disconnect", { method: "POST" });
  } catch (err) {
    console.error("[github] disconnect failed", err);
    const target = new URL("/app/integrations/github", process.env.NEXTAUTH_URL);
    target.searchParams.set("error", "github_disconnect_failed");
    if (after) target.searchParams.set("returnTo", after);
    return NextResponse.redirect(target);
  }

  const target = new URL("/app/integrations/github", process.env.NEXTAUTH_URL);
  target.searchParams.set("github", "disconnected");
  if (after) target.searchParams.set("returnTo", after);
  return NextResponse.redirect(target);
}

