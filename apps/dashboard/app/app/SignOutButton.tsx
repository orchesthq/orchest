"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";
import { InlineSpinner } from "@/components/InlineSpinner";

export function SignOutButton() {
  const [loading, setLoading] = useState(false);
  return (
    <button
      onClick={async () => {
        setLoading(true);
        await signOut({ callbackUrl: "/" });
      }}
      disabled={loading}
      title="Sign out"
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
    >
      {loading ? (
        <InlineSpinner className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
          <path fillRule="evenodd" d="M2 4.75A2.75 2.75 0 014.75 2h3.5a.75.75 0 010 1.5h-3.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h3.5a.75.75 0 010 1.5h-3.5A2.75 2.75 0 012 11.25v-6.5zm9.47.47a.75.75 0 011.06 0l2.25 2.25a.75.75 0 010 1.06l-2.25 2.25a.75.75 0 11-1.06-1.06l.97-.97H6.75a.75.75 0 010-1.5h5.69l-.97-.97a.75.75 0 010-1.06z" clipRule="evenodd" />
        </svg>
      )}
      {loading ? "…" : "Sign out"}
    </button>
  );
}
