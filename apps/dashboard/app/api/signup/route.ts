import { NextResponse } from "next/server";
import { z } from "zod";
import { apiCreateClient, apiCreateMembership } from "@/lib/internalApi";
import { createEmailVerificationToken, createUser, getUserByEmail } from "@/lib/users";
import { EmailConfigError, sendVerificationEmail } from "@/lib/email";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  clientName: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => null);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const existing = await getUserByEmail(parsed.data.email);
    if (existing) {
      return NextResponse.json({ error: "User already exists" }, { status: 409 });
    }

    const user = await createUser({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    const { clientId } = await apiCreateClient({
      name: parsed.data.clientName,
      createDefaultAgent: false,
    });

    await apiCreateMembership({
      clientId,
      userId: user.id,
      role: "owner",
    });

    const verificationToken = await createEmailVerificationToken({
      userId: user.id,
      email: user.email,
      purpose: "signup",
      expiresInHours: 24,
    });
    const origin = process.env.APP_BASE_URL?.trim() || new URL(req.url).origin;
    const verificationUrl = `${origin}/verify-email?token=${encodeURIComponent(verificationToken)}`;
    await sendVerificationEmail({
      toEmail: user.email,
      verifyUrl: verificationUrl,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof EmailConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }

    // Common misconfig: migrations not applied yet.
    if (String(err?.code) === "42P01" || message.toLowerCase().includes("relation \"users\" does not exist")) {
      return NextResponse.json(
        {
          error:
            "Database tables are missing. Apply migrations 001_init.sql and 002_auth_and_membership.sql to your Postgres database.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

