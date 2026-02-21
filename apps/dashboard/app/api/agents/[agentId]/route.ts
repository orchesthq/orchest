import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { z } from "zod";
import { apiFetchForClient } from "@/lib/apiForClient";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const session = await getServerSession(authOptions);
  const clientId = session?.user?.clientId;
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { agentId } = await params;
  const agentIdParsed = z.string().uuid().safeParse(agentId);
  if (!agentIdParsed.success) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const result = await apiFetchForClient(clientId, `/agents/${agentIdParsed.data}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed.data),
  });

  return NextResponse.json(result);
}

