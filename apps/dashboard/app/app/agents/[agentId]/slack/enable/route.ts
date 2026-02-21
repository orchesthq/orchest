import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { z } from "zod";
import { apiFetchForClient } from "@/lib/apiForClient";
import { getClientIdFromSession } from "@/lib/session";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);
  if (!clientId) return NextResponse.redirect(new URL("/sign-in", process.env.NEXTAUTH_URL));

  const { agentId } = await params;
  const agentIdParsed = z.string().uuid().safeParse(agentId);
  if (!agentIdParsed.success) {
    return NextResponse.redirect(new URL("/app/agents", process.env.NEXTAUTH_URL));
  }

  const form = await req.formData().catch(() => null);
  const botKey = z.string().min(1).parse((form?.get("bot") as string | null) ?? "ava");

  await apiFetchForClient(clientId, `/internal/slack/agents/${agentIdParsed.data}/enable`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ botKey }),
  });

  return NextResponse.redirect(
    new URL(`/app/agents/${agentIdParsed.data}?slack=enabled`, process.env.NEXTAUTH_URL)
  );
}

