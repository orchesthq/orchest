"use client";

import { useState } from "react";
import { InlineSpinner } from "@/components/InlineSpinner";
import { authBtnCls, AuthError, AuthSuccess } from "@/components/AuthCard";

export function VerifyEmailForm({ token }: { token: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setOk(null);

        const res = await fetch("/api/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const j = await res.json().catch(() => ({}));

        if (!res.ok) {
          setError(j?.error ?? "Verification failed");
          setLoading(false);
          return;
        }

        setOk(`${j?.email ?? "Email"} verified — you can now sign in.`);
        setLoading(false);
      }}
    >
      {!token && <AuthError message="Missing verification token." />}
      {error && <AuthError message={error} />}
      {ok && <AuthSuccess message={ok} />}

      <button type="submit" disabled={loading || !token} className={authBtnCls}>
        {loading ? <InlineSpinner className="h-4 w-4 animate-spin" /> : null}
        {loading ? "Verifying…" : "Verify email"}
      </button>
    </form>
  );
}
