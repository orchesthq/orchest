import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";
import { AcceptInviteForm } from "./acceptInviteForm";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <AuthCard
      title="You're invited to Orchest"
      subtitle="Create or link your account to join this workspace."
      footer={
        <p className="text-sm text-zinc-500">
          Already have access?{" "}
          <Link className="font-medium text-violet-400 hover:text-violet-300" href="/sign-in">
            Sign in
          </Link>
        </p>
      }
    >
      <AcceptInviteForm token={token} />
    </AuthCard>
  );
}
