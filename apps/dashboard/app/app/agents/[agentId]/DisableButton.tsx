"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { InlineSpinner } from "@/components/InlineSpinner";

export function DisableButton(props: { agentId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={async () => {
        if (!confirm("Disable this agent? This removes the agent and its data.")) {
            return;
        }
          setError(null);
          setPending(true);
          try {
            const res = await fetch(`/api/agents/${encodeURIComponent(props.agentId)}`, {
              method: "DELETE",
            });
            if (!res.ok) {
              const data = (await res.json().catch(() => null)) as null | { error?: string };
              throw new Error(data?.error || `Disable failed (${res.status})`);
            }

            router.push("/app/agents");
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setPending(false);
          }
        }}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? <InlineSpinner className="h-4 w-4 animate-spin" /> : null}
        {pending ? "Disabling…" : "Disable"}
      </button>

      {error ? <div className="max-w-[42ch] text-right text-xs text-rose-700">{error}</div> : null}
    </div>
  );
}
