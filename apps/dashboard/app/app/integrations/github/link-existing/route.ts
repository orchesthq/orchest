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

  const formData = await req.formData();
  const installationIdRaw = String(formData.get("installationId") ?? "").trim();
  const returnTo = String(formData.get("returnTo") ?? "").trim();
  const installationId = installationIdRaw ? parseInt(installationIdRaw, 10) : NaN;

  const target = new URL("/app/integrations/github", process.env.NEXTAUTH_URL);
  if (returnTo) target.searchParams.set("returnTo", returnTo);

  if (!Number.isFinite(installationId) || installationId <= 0) {
    target.searchParams.set("error", "github_invalid_installation_id");
    return NextResponse.redirect(target);
  }

  try {
    await apiFetchForClient(clientId, "/internal/github/complete-installation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installationId }),
    });
  } catch (err) {
    console.error("[github] link-existing failed", err);
    target.searchParams.set("error", "github_install_failed");
    return NextResponse.redirect(target);
  }

  target.searchParams.set("github", "connected");
  return NextResponse.redirect(target);
}

