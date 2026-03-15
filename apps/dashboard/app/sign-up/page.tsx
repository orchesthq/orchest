import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";
import { SignUpForm } from "./SignUpForm";

export default function SignUpPage() {
  return (
    <AuthCard
      title="Create your workspace"
      subtitle="Set up your Orchest account and invite your team."
      footer={
        <p className="text-sm text-zinc-500">
          Already have an account?{" "}
          <Link className="font-medium text-violet-400 hover:text-violet-300" href="/sign-in">
            Sign in
          </Link>
        </p>
      }
    >
      <SignUpForm />
    </AuthCard>
  );
}
