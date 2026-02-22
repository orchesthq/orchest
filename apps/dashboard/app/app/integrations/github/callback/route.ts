import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiFetchForClient } from "@/lib/apiForClient";

const GITHUB_CONNECT_COOKIE = "orchest_github_connect";

function buildRedirectTarget(input: { path: string; query: Record<string, string> }): string {
  const base = process.env.NEXTAUTH_URL ?? process.env.DASHBOARD_BASE_URL ?? "http://localhost:3001";
  const targetUrl = new URL(input.path, base.replace(/\/+$/, ""));
  for (const [k, v] of Object.entries(input.query)) {
    targetUrl.searchParams.set(k, v);
  }
  return targetUrl.toString();
}

export async function GET(req: Request) {
  const searchParams = new URL(req.url).searchParams;
  const installationIdRaw = searchParams.get("installation_id");
  const installationId = installationIdRaw ? parseInt(installationIdRaw, 10) : null;

  const cookieStore = await cookies();
  const cookie = cookieStore.get(GITHUB_CONNECT_COOKIE)?.value;
  const integrationPath = "/app/integrations/github";
  if (!cookie) {
    const target = buildRedirectTarget({
      path: integrationPath,
      query: {
        error:
          !installationId || !Number.isFinite(installationId)
            ? "github_no_installation_id"
            : "github_session_expired",
      },
    });
    return NextResponse.redirect(target);
  }

  let parsed: { clientId: string; returnTo: string };
  try {
    parsed = JSON.parse(cookie) as { clientId: string; returnTo: string };
  } catch {
    const target = buildRedirectTarget({ path: integrationPath, query: { error: "github_invalid_session" } });
    const res = NextResponse.redirect(target);
    res.cookies.delete(GITHUB_CONNECT_COOKIE);
    return res;
  }

  const { clientId, returnTo } = parsed;

  if (!installationId || !Number.isFinite(installationId)) {
    const target = buildRedirectTarget({
      path: integrationPath,
      query: { error: "github_no_installation_id", returnTo },
    });
    const res = NextResponse.redirect(target);
    res.cookies.delete(GITHUB_CONNECT_COOKIE);
    return res;
  }

  try {
    await apiFetchForClient(clientId, "/internal/github/complete-installation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installationId }),
    });
  } catch (err) {
    console.error("[github] complete-installation failed", err);
    const target = buildRedirectTarget({
      path: integrationPath,
      query: { error: "github_install_failed", returnTo },
    });
    const res = NextResponse.redirect(target);
    res.cookies.delete(GITHUB_CONNECT_COOKIE);
    return res;
  }

  const target = buildRedirectTarget({
    path: integrationPath,
    query: { github: "connected", returnTo },
  });
  const res = NextResponse.redirect(target);
  res.cookies.delete(GITHUB_CONNECT_COOKIE);
  return res;
}
