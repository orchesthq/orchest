import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";
import { ResetPasswordForm } from "./ResetPasswordForm";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = sp.token;
  const token = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");

  return (
    <AuthCard
      title="Reset password"
      subtitle="Set a new password for your Orchest account."
      footer={
        <p className="text-sm text-zinc-500">
          Back to{" "}
          <Link className="font-medium text-violet-400 hover:text-violet-300" href="/sign-in">
            sign in
          </Link>
        </p>
      }
    >
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
