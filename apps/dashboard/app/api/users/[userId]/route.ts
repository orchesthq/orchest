import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { z } from "zod";
import { authOptions } from "@/auth";
import { getClientIdFromSession } from "@/lib/session";
import { revokeUserAccessFromClient } from "@/lib/users";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);
  const currentUserId = (session?.user as any)?.id as string | undefined;
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await params;
  const parsed = z.string().uuid().safeParse(userId);
  if (!parsed.success) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  if (currentUserId && parsed.data === currentUserId) {
    return NextResponse.json({ error: "You cannot revoke your own access." }, { status: 400 });
  }

  try {
    await revokeUserAccessFromClient({ clientId, userId: parsed.data });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
