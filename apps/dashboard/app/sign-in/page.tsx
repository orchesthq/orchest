import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";
import { SignInForm } from "./SignInForm";

export default function SignInPage() {
  return (
    <AuthCard
      title="Sign in"
      subtitle="Access your Orchest workspace."
      footer={
        <p className="text-sm text-zinc-500">
          New here?{" "}
          <Link className="font-medium text-violet-400 hover:text-violet-300" href="/sign-up">
            Create an account
          </Link>
        </p>
      }
    >
      <SignInForm />
    </AuthCard>
  );
}
