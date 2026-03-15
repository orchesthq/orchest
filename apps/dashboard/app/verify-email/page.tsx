import Link from "next/link";
import { VerifyEmailForm } from "./verifyEmailForm";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = sp.token;
  const token = Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-zinc-900">Verify your email</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Confirm your email to activate your Orchest account.
      </p>
      <VerifyEmailForm token={token} />
      <div className="mt-6 text-sm text-zinc-600">
        <Link className="underline" href="/sign-in">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
