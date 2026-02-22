import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";
import { getClientIdFromSession } from "@/lib/session";

const GITHUB_CONNECT_COOKIE = "orchest_github_connect";
const COOKIE_MAX_AGE = 600; // 10 minutes

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);
  if (!clientId) {
    return NextResponse.redirect(new URL("/sign-in", process.env.NEXTAUTH_URL));
  }

  const returnTo =
    new URL(req.url).searchParams.get("returnTo") ?? "/app/integrations/github";

  let url: string;
  try {
    const r = await apiFetchForClient<{ url: string }>(clientId, "/internal/github/install-url", {
      method: "GET",
    });
    url = r.url;
  } catch (err) {
    console.error("[github] install-url failed", err);
    return NextResponse.redirect(
      new URL("/app/integrations/github?error=github_install_url_failed", process.env.NEXTAUTH_URL)
    );
  }

  const res = NextResponse.redirect(url);
  res.cookies.set(GITHUB_CONNECT_COOKIE, JSON.stringify({ clientId, returnTo }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });

  return res;
}
