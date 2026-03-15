import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { z } from "zod";
import { authOptions } from "@/auth";
import { getClientIdFromSession } from "@/lib/session";
import { createClientInvite } from "@/lib/users";
import { EmailConfigError, sendClientInviteEmail } from "@/lib/email";

const schema = z.object({
  email: z.string().email(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);
  const invitedByUserId = (session?.user as any)?.id as string | undefined;
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const json = await req.json().catch(() => null);
    const parsed = schema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const token = await createClientInvite({
      clientId,
      email: parsed.data.email,
      invitedByUserId: invitedByUserId ?? null,
      expiresInHours: 72,
    });

    const origin = process.env.APP_BASE_URL?.trim() || new URL(req.url).origin;
    const inviteUrl = `${origin}/invite/${encodeURIComponent(token)}`;
    await sendClientInviteEmail({
      toEmail: parsed.data.email,
      inviteUrl,
      invitedByEmail: (session?.user as any)?.email ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof EmailConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
