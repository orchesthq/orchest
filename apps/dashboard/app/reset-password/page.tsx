import Link from "next/link";
import { ResetPasswordForm } from "./ResetPasswordForm";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = sp.token;
  const token = Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-md px-6 py-16">
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Reset password</h1>
          <p className="mt-2 text-sm text-zinc-600">Set a new password for your Orchest account.</p>
          <ResetPasswordForm token={token} />
          <p className="mt-6 text-sm text-zinc-600">
            Back to{" "}
            <Link className="font-medium text-zinc-900 hover:underline" href="/sign-in">
              sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
