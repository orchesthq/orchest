import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { z } from "zod";
import { authOptions } from "@/auth";
import { getClientIdFromSession } from "@/lib/session";
import { revokeClientInvite } from "@/lib/users";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ inviteId: string }> }
) {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { inviteId } = await params;
  const parsed = z.string().uuid().safeParse(inviteId);
  if (!parsed.success) return NextResponse.json({ error: "Invalid invite id" }, { status: 400 });

  try {
    await revokeClientInvite({ clientId, inviteId: parsed.data });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
