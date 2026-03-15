"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { InlineSpinner } from "@/components/InlineSpinner";
import { authInputCls, authLabelCls, authBtnCls, AuthError, AuthSuccess } from "@/components/AuthCard";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);

        if (!token) { setError("Missing reset token."); return; }
        if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
        if (password !== confirmPassword) { setError("Passwords do not match."); return; }

        setLoading(true);
        const res = await fetch("/api/password/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, password }),
        });
        const j = await res.json().catch(() => ({}));

        if (!res.ok) {
          setError(j?.error ?? "Could not reset password");
          setLoading(false);
          return;
        }

        setDone(true);
        setLoading(false);
        setTimeout(() => router.push("/sign-in"), 1500);
      }}
    >
      <div className="space-y-1.5">
        <label className={authLabelCls}>New password</label>
        <input
          className={authInputCls}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </div>

      <div className="space-y-1.5">
        <label className={authLabelCls}>Confirm new password</label>
        <input
          className={authInputCls}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </div>

      {error && <AuthError message={error} />}
      {done && <AuthSuccess message="Password reset. Redirecting to sign in…" />}

      <button type="submit" disabled={loading} className={authBtnCls}>
        {loading ? <InlineSpinner className="h-4 w-4 animate-spin" /> : null}
        {loading ? "Resetting…" : "Reset password"}
      </button>
    </form>
  );
}
