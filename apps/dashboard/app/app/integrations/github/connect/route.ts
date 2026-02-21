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
    new URL(req.url).searchParams.get("returnTo") ?? "/app/agents";

  const { url } = await apiFetchForClient<{ url: string }>(
    clientId,
    "/internal/github/install-url",
    { method: "GET" }
  );

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
