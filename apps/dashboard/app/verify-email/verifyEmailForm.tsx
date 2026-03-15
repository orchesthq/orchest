"use client";

import { useState } from "react";
import { InlineSpinner } from "@/components/InlineSpinner";

export function VerifyEmailForm({ token }: { token: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  return (
    <form
      className="mt-6 space-y-3"
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
        setOk(`Verified ${j?.email ?? "email"} successfully. You can now sign in.`);
        setLoading(false);
      }}
    >
      <button
        type="submit"
        disabled={loading || !token}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {loading ? <InlineSpinner className="h-4 w-4 animate-spin" /> : null}
        {loading ? "Verifying…" : "Verify email"}
      </button>
      {!token ? <div className="text-sm text-red-700">Missing verification token.</div> : null}
      {error ? <div className="text-sm text-red-700">{error}</div> : null}
      {ok ? <div className="text-sm text-emerald-700">{ok}</div> : null}
    </form>
  );
}
