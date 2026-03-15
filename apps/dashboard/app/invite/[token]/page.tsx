import Link from "next/link";
import { AcceptInviteForm } from "./acceptInviteForm";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-zinc-900">You are invited to Orchest</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Create or link your account to join this client workspace.
      </p>
      <AcceptInviteForm token={token} />
      <div className="mt-6 text-sm text-zinc-600">
        <Link className="underline" href="/sign-in">
          Already have access? Sign in
        </Link>
      </div>
    </div>
  );
}
