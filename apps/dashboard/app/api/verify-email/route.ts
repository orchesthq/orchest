import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyEmailToken } from "@/lib/users";

const schema = z.object({
  token: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => null);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const verified = await verifyEmailToken(parsed.data.token);
    if (!verified) {
      return NextResponse.json({ error: "Verification token is invalid or expired." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, email: verified.email });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
