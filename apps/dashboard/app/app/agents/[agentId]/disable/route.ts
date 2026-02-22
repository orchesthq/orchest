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
  const origin = new URL(req.url).origin;
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);
  if (!clientId) return NextResponse.redirect(new URL("/sign-in", origin), 303);

  const { agentId } = await params;
  const agentIdParsed = z.string().uuid().safeParse(agentId);
  if (!agentIdParsed.success) {
    return NextResponse.redirect(new URL("/app/agents", origin), 303);
  }

  try {
    await apiFetchForClient(clientId, `/agents/${agentIdParsed.data}`, {
      method: "DELETE",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const target = new URL(`/app/agents/${agentIdParsed.data}`, origin);
    target.searchParams.set("error", "agent_disable_failed");
    target.searchParams.set("details", msg.slice(0, 300));
    return NextResponse.redirect(target, 303);
  }

  return NextResponse.redirect(new URL("/app/agents", origin), 303);
}
