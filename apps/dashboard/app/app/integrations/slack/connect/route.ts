import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { apiFetchForClient } from "@/lib/apiForClient";

export async function GET() {
  const session = await getServerSession(authOptions);
  const clientId = session?.user?.clientId;
  if (!clientId) return NextResponse.redirect(new URL("/sign-in", process.env.NEXTAUTH_URL));

  const { url } = await apiFetchForClient<{ url: string }>(clientId, "/internal/slack/install-url", {
    method: "GET",
  });

  return NextResponse.redirect(url);
}

