import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";
import { getClientIdFromSession } from "@/lib/session";
import { z } from "zod";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);
  if (!clientId) {
    return NextResponse.redirect(new URL("/sign-in", process.env.NEXTAUTH_URL));
  }

  const { agentId } = await params;
  const agentIdParsed = z.string().uuid().safeParse(agentId);
  if (!agentIdParsed.success) {
    return NextResponse.redirect(new URL("/app/agents", process.env.NEXTAUTH_URL));
  }

  try {
    await apiFetchForClient(clientId, `/internal/github/agents/${agentIdParsed.data}/unlink`, {
      method: "POST",
    });
  } catch (err) {
    console.error("[github] unlink failed", err);
    return NextResponse.redirect(
      new URL(`/app/agents/${agentIdParsed.data}?error=github_unlink_failed`, process.env.NEXTAUTH_URL)
    );
  }

  return NextResponse.redirect(
    new URL(`/app/agents/${agentIdParsed.data}?github=unlinked`, process.env.NEXTAUTH_URL)
  );
}

