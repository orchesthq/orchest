import { NextResponse } from "next/server";
import { z } from "zod";
import { createPasswordResetTokenForEmail } from "@/lib/users";
import { EmailConfigError, sendPasswordResetEmail } from "@/lib/email";

const schema = z.object({
  email: z.string().email(),
});

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => null);
    const parsed = schema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const token = await createPasswordResetTokenForEmail(parsed.data.email);
    if (token) {
      const origin = process.env.APP_BASE_URL?.trim() || new URL(req.url).origin;
      const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
      await sendPasswordResetEmail({
        toEmail: parsed.data.email.toLowerCase(),
        resetUrl,
      });
    }

    // Always return ok to avoid account enumeration.
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof EmailConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
