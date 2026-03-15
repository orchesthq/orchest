"use client";

import { useState } from "react";
import { InlineSpinner } from "@/components/InlineSpinner";
import { authInputCls, authLabelCls, authBtnCls, AuthError, AuthSuccess } from "@/components/AuthCard";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSent(false);

        const res = await fetch("/api/password/forgot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const j = await res.json().catch(() => ({}));

        if (!res.ok) {
          setError(j?.error ?? "Could not send reset email");
          setLoading(false);
          return;
        }

        setSent(true);
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

      {error && <AuthError message={error} />}
      {sent && (
        <AuthSuccess message="If an account exists for that email, a reset link is on its way." />
      )}

      <button type="submit" disabled={loading} className={authBtnCls}>
        {loading ? <InlineSpinner className="h-4 w-4 animate-spin" /> : null}
        {loading ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
