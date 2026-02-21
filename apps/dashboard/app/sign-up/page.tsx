import Link from "next/link";
import { SignUpForm } from "./SignUpForm";

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-md px-6 py-16">
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Create your client workspace
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            We’ll create your company. You can add agents after you sign in.
          </p>

          <SignUpForm />

          <p className="mt-6 text-sm text-zinc-600">
            Already have an account?{" "}
            <Link className="font-medium text-zinc-900 hover:underline" href="/sign-in">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

