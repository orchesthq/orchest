import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";
import { getClientIdFromSession } from "@/lib/session";

export async function POST() {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);
  if (!clientId) {
    return NextResponse.redirect(new URL("/sign-in", process.env.NEXTAUTH_URL));
  }

  try {
    await apiFetchForClient(clientId, "/internal/github/disconnect", { method: "POST" });
  } catch (err) {
    console.error("[github] disconnect failed", err);
    return NextResponse.redirect(
      new URL("/app/integrations/github?error=github_disconnect_failed", process.env.NEXTAUTH_URL)
    );
  }

  return NextResponse.redirect(
    new URL("/app/integrations/github?github=disconnected", process.env.NEXTAUTH_URL)
  );
}

