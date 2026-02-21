import Link from "next/link";
import { SignInForm } from "./SignInForm";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-md px-6 py-16">
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Sign in
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Access your client dashboard.
          </p>

          <SignInForm />

          <p className="mt-6 text-sm text-zinc-600">
            New here?{" "}
            <Link className="font-medium text-zinc-900 hover:underline" href="/sign-up">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

