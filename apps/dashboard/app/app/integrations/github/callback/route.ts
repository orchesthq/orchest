import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiFetchForClient } from "@/lib/apiForClient";

const GITHUB_CONNECT_COOKIE = "orchest_github_connect";

export async function GET(req: Request) {
  const searchParams = new URL(req.url).searchParams;
  const installationIdRaw = searchParams.get("installation_id");
  const installationId = installationIdRaw ? parseInt(installationIdRaw, 10) : null;

  if (!installationId || !Number.isFinite(installationId)) {
    return NextResponse.redirect(
      new URL("/app/agents?error=github_no_installation_id", process.env.NEXTAUTH_URL)
    );
  }

  const cookieStore = await cookies();
  const cookie = cookieStore.get(GITHUB_CONNECT_COOKIE)?.value;
  if (!cookie) {
    return NextResponse.redirect(
      new URL("/app/agents?error=github_session_expired", process.env.NEXTAUTH_URL)
    );
  }

  let parsed: { clientId: string; returnTo: string };
  try {
    parsed = JSON.parse(cookie) as { clientId: string; returnTo: string };
  } catch {
    return NextResponse.redirect(
      new URL("/app/agents?error=github_invalid_session", process.env.NEXTAUTH_URL)
    );
  }

  const { clientId, returnTo } = parsed;

  try {
    await apiFetchForClient(clientId, "/internal/github/complete-installation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installationId }),
    });
  } catch (err) {
    console.error("[github] complete-installation failed", err);
    return NextResponse.redirect(
      new URL(`/app/agents?error=github_install_failed`, process.env.NEXTAUTH_URL)
    );
  }

  const res = NextResponse.redirect(new URL(returnTo, process.env.NEXTAUTH_URL));
  res.cookies.delete(GITHUB_CONNECT_COOKIE);
  return res;
}
