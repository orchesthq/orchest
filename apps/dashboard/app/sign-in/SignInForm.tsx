"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { InlineSpinner } from "@/components/InlineSpinner";
import { authInputCls, authLabelCls, authBtnCls, AuthError } from "@/components/AuthCard";

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const res = await signIn("credentials", { email, password, redirect: false });

        if (res?.error) {
          setError("Incorrect email or password.");
          setLoading(false);
          return;
        }

        router.push("/app");
        setLoading(false);
      }}
    >
      <div className="space-y-1.5">
        <label className={authLabelCls}>Email</label>
        <input
          className={authInputCls}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          autoComplete="email"
          required
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className={authLabelCls}>Password</label>
          <Link className="text-xs text-violet-400 hover:text-violet-300" href="/forgot-password">
            Forgot password?
          </Link>
        </div>
        <input
          className={authInputCls}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      {error && <AuthError message={error} />}

      <button type="submit" disabled={loading} className={authBtnCls}>
        {loading ? <InlineSpinner className="h-4 w-4 animate-spin" /> : null}
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
