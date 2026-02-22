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
      className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
    >
      {loading ? <InlineSpinner className="h-4 w-4 animate-spin" /> : null}
      {loading ? "Signing out…" : "Sign out"}
    </button>
  );
}

