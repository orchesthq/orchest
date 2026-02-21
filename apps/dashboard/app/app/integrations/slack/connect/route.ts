import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";
import { z } from "zod";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const clientId = session?.user?.clientId;
  if (!clientId) return NextResponse.redirect(new URL("/sign-in", process.env.NEXTAUTH_URL));

  const bot = z
    .string()
    .min(1)
    .parse(new URL(req.url).searchParams.get("bot") ?? "ava");

  const { url } = await apiFetchForClient<{ url: string }>(
    clientId,
    `/internal/slack/install-url?bot=${encodeURIComponent(bot)}`,
    {
    method: "GET",
    }
  );

  return NextResponse.redirect(url);
}

