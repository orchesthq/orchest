"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { InlineSpinner } from "@/components/InlineSpinner";

export function RevokeInviteButton({ inviteId, email }: { inviteId: string; email: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={loading}
        onClick={async () => {
          if (!confirm(`Revoke invite for ${email}?`)) return;
          setLoading(true);
          setError(null);
          const res = await fetch(`/api/users/invite/${inviteId}`, { method: "DELETE" });
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            setError(j?.error ?? "Failed to revoke invite");
            setLoading(false);
            return;
          }
          router.refresh();
        }}
        className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {loading ? <InlineSpinner className="h-3 w-3 animate-spin" /> : null}
        Revoke invite
      </button>
      {error ? <div className="text-xs text-red-700">{error}</div> : null}
    </div>
  );
}
