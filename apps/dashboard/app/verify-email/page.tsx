import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";
import { VerifyEmailForm } from "./verifyEmailForm";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = sp.token;
  const token = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");

  return (
    <AuthCard
      title="Verify your email"
      subtitle="Confirm your email address to activate your Orchest account."
      footer={
        <p className="text-sm text-zinc-500">
          <Link className="font-medium text-violet-400 hover:text-violet-300" href="/sign-in">
            Back to sign in
          </Link>
        </p>
      }
    >
      <VerifyEmailForm token={token} />
    </AuthCard>
  );
}
