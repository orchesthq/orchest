"use client";

import { useState } from "react";
import { InlineSpinner } from "@/components/InlineSpinner";
import { authInputCls, authLabelCls, authBtnCls, AuthError, AuthSuccess } from "@/components/AuthCard";

export function SignUpForm() {
  const [clientName, setClientName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSent(false);

        const res = await fetch("/api/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientName, email, password }),
        });

        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setError(j?.error ?? "Sign up failed");
          setLoading(false);
          return;
        }

        setSent(true);
        setLoading(false);
      }}
    >
      <div className="space-y-1.5">
        <label className={authLabelCls}>Company name</label>
        <input
          className={authInputCls}
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          placeholder="Acme Inc"
          required
        />
      </div>

      <div className="space-y-1.5">
        <label className={authLabelCls}>Work email</label>
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
        <label className={authLabelCls}>Password</label>
        <input
          className={authInputCls}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <p className="text-xs text-zinc-500">Minimum 8 characters.</p>
      </div>

      {error && <AuthError message={error} />}
      {sent && (
        <AuthSuccess message="Account created — check your inbox and verify your email before signing in." />
      )}

      <button type="submit" disabled={loading} className={authBtnCls}>
        {loading ? <InlineSpinner className="h-4 w-4 animate-spin" /> : null}
        {loading ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
