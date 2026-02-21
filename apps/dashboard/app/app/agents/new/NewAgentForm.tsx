"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AGENT_TEMPLATES, getTemplateByRole } from "@/lib/agentTemplates";
import { ORCHEST_PERSONAS } from "@/lib/personas";

const DEFAULT_ROLE_BY_PERSONA: Record<string, string> = {
  ava: "ai_software_engineer",
  ben: "ai_devops_sre",
  priya: "ai_product_manager",
  sofia: "ai_data_analyst",
  amira: "ai_customer_support",
};

export function NewAgentForm() {
  const router = useRouter();
  const [personaKey, setPersonaKey] = useState<string>("ava");
  const [role, setRole] = useState("ai_software_engineer");
  const [systemPrompt, setSystemPrompt] = useState(
    getTemplateByRole("ai_software_engineer")?.defaultSystemPrompt ?? ""
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mt-8 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const res = await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            personaKey,
            role,
            systemPrompt: systemPrompt.trim().length > 0 ? systemPrompt : undefined,
          }),
        });

        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setError(j?.error ?? "Failed to create agent");
          setLoading(false);
          return;
        }

        const j = await res.json();
        const agentId = j?.agent?.id as string | undefined;
        router.push(agentId ? `/app/agents/${agentId}` : "/app/agents");
      }}
    >
      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-900">Persona</label>
        <select
          className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
          value={personaKey}
          onChange={(e) => {
            const nextPersona = e.target.value;
            setPersonaKey(nextPersona);

            const nextRole = DEFAULT_ROLE_BY_PERSONA[nextPersona] ?? "ai_software_engineer";
            const currentTemplate = getTemplateByRole(role);
            const isUsingTemplatePrompt =
              currentTemplate && systemPrompt.trim() === currentTemplate.defaultSystemPrompt.trim();

            setRole(nextRole);
            if (isUsingTemplatePrompt) {
              const nextTemplate = getTemplateByRole(nextRole);
              if (nextTemplate) setSystemPrompt(nextTemplate.defaultSystemPrompt);
            }
          }}
        >
          {ORCHEST_PERSONAS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name} — {p.description}
            </option>
          ))}
        </select>
        <p className="text-xs text-zinc-500">Persona names are fixed. You can change role + personality later.</p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-900">Role</label>
        <select
          className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
          value={role}
          onChange={(e) => {
            const nextRole = e.target.value;
            setRole(nextRole);

            // If the user hasn't customized the system prompt, keep it in sync with the selected template.
            const currentTemplate = getTemplateByRole(role);
            const nextTemplate = getTemplateByRole(nextRole);
            const isUsingTemplatePrompt =
              currentTemplate && systemPrompt.trim() === currentTemplate.defaultSystemPrompt.trim();
            if (isUsingTemplatePrompt && nextTemplate) setSystemPrompt(nextTemplate.defaultSystemPrompt);
          }}
        >
          {AGENT_TEMPLATES.map((t) => (
            <option key={t.role} value={t.role}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-900">
          System prompt
        </label>
        <textarea
          className="min-h-[120px] w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="How should this agent behave?"
        />
        <p className="text-xs text-zinc-500">
          Starts from the selected role template. You can customize it per agent.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="inline-flex w-full items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {loading ? "Hiring..." : "Hire persona"}
      </button>
    </form>
  );
}

