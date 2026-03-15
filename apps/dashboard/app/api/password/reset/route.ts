import { NextResponse } from "next/server";
import { z } from "zod";
import { resetPasswordFromToken } from "@/lib/users";

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => null);
    const parsed = schema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const ok = await resetPasswordFromToken({
      token: parsed.data.token,
      newPassword: parsed.data.password,
    });
    if (!ok) {
      return NextResponse.json({ error: "Reset token is invalid or expired." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
