"use client";

import { useState } from "react";
import { InlineSpinner } from "@/components/InlineSpinner";

export function InviteUserForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setInviteUrl(null);
        const res = await fetch("/api/users/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(j?.error ?? "Invite failed");
          setLoading(false);
          return;
        }
        setInviteUrl(j?.inviteUrl ?? null);
        setEmail("");
        setLoading(false);
      }}
    >
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@company.com"
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {loading ? <InlineSpinner className="h-4 w-4 animate-spin" /> : null}
          Invite
        </button>
      </div>
      {error ? <div className="text-sm text-red-700">{error}</div> : null}
      {inviteUrl ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Invite link generated:
          {" "}
          <a href={inviteUrl} className="underline">
            {inviteUrl}
          </a>
        </div>
      ) : null}
    </form>
  );
}
