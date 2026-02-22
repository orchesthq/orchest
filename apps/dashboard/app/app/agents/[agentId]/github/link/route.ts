import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";
import { getClientIdFromSession } from "@/lib/session";
import { z } from "zod";

export async function POST(
  req: Request,
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

  const formData = await req.formData();
  const connectionId = (formData.get("connectionId") as string)?.trim() ?? "";
  const commitAuthorName = (formData.get("commitAuthorName") as string)?.trim() ?? "";
  const commitAuthorEmail = (formData.get("commitAuthorEmail") as string)?.trim() ?? "";
  const defaultRepo = (formData.get("defaultRepo") as string)?.trim() ?? "";
  const accessLevel = (formData.get("accessLevel") as string) || "pr_only";

  if (!defaultRepo) {
    return NextResponse.redirect(
      new URL(
        `/app/agents/${agentIdParsed.data}?error=github_repo_required`,
        process.env.NEXTAUTH_URL
      )
    );
  }

  try {
    if (connectionId) {
      await apiFetchForClient(
        clientId,
        `/internal/github/agents/${agentIdParsed.data}/connections/${connectionId}/update`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commitAuthorName: commitAuthorName || undefined,
            commitAuthorEmail: commitAuthorEmail || undefined,
            defaultRepo,
            accessLevel: ["read", "pr_only", "direct_push"].includes(accessLevel)
              ? accessLevel
              : undefined,
          }),
        }
      );
    } else {
      await apiFetchForClient(clientId, `/internal/github/agents/${agentIdParsed.data}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commitAuthorName: commitAuthorName || undefined,
          commitAuthorEmail: commitAuthorEmail || undefined,
          defaultRepo,
          accessLevel: ["read", "pr_only", "direct_push"].includes(accessLevel) ? accessLevel : undefined,
        }),
      });
    }
  } catch (err) {
    console.error("[github] link failed", err);
    return NextResponse.redirect(
      new URL(
        `/app/agents/${agentIdParsed.data}?error=${connectionId ? "github_update_failed" : "github_link_failed"}`,
        process.env.NEXTAUTH_URL
      )
    );
  }

  return NextResponse.redirect(
    new URL(`/app/agents/${agentIdParsed.data}?github=${connectionId ? "updated" : "linked"}`, process.env.NEXTAUTH_URL)
  );
}
