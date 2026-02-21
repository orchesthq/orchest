import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { z } from "zod";
import { apiFetchForClient } from "@/lib/apiForClient";

const createSchema = z.object({
  personaKey: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const clientId = session?.user?.clientId;
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const result = await apiFetchForClient<{ agent: { id: string } }>(clientId, "/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed.data),
  });

  return NextResponse.json(result);
}

