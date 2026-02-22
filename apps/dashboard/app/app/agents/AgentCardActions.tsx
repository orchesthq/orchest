"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEFAULT_ROLE_BY_PERSONA } from "@/lib/personas";
import { InlineSpinner } from "@/components/InlineSpinner";

type Agent = {
  id: string;
  persona_key?: string | null;
  name: string;
  role: string;
};

type Props = {
  personaKey: string;
  personaName: string;
  agent: Agent | null;
};

export function AgentCardActions({ personaKey, personaName, agent }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleHire() {
    setLoading("hire");
    setError(null);
    try {
      const role = DEFAULT_ROLE_BY_PERSONA[personaKey] ?? "ai_software_engineer";
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaKey, role }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error ?? "Failed to hire");
        return;
      }
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  async function handleDisable() {
    if (!agent || !confirm(`Disable ${personaName}? This removes the agent and its data.`)) return;
    setLoading("disable");
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Failed to disable");
        return;
      }
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  if (error) {
    return (
      <div className="mt-5 space-y-2">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      {!agent ? (
        <button
          type="button"
          onClick={handleHire}
          disabled={loading === "hire"}
          className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {loading === "hire" ? (
            <>
              <InlineSpinner className="h-4 w-4 animate-spin" /> Hiring…
            </>
          ) : (
            "Hire"
          )}
        </button>
      ) : (
        <>
          <Link
            href={`/app/agents/${agent.id}`}
            className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            Manage
          </Link>
          <button
            type="button"
            onClick={handleDisable}
            disabled={loading === "disable"}
            className="inline-flex items-center rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {loading === "disable" ? (
              <>
                <InlineSpinner className="h-4 w-4 animate-spin" /> Disabling…
              </>
            ) : (
              "Disable"
            )}
          </button>
        </>
      )}
    </div>
  );
}
