import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";
import { z } from "zod";
import { getClientIdFromSession } from "@/lib/session";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);
  if (!clientId) return NextResponse.redirect(new URL("/sign-in", process.env.NEXTAUTH_URL));

  const searchParams = new URL(req.url).searchParams;
  const bot = z.string().min(1).parse(searchParams.get("bot") ?? "ava");
  const agentId = searchParams.get("agentId") ?? null;

  const urlParams = new URLSearchParams({ bot });
  if (agentId && z.string().uuid().safeParse(agentId).success) {
    urlParams.set("agentId", agentId);
  }
  const { url } = await apiFetchForClient<{ url: string }>(
    clientId,
    `/internal/slack/install-url?${urlParams.toString()}`,
    { method: "GET" }
  );

  return NextResponse.redirect(url);
}

