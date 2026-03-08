"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { AGENT_TEMPLATES, getTemplateByRole } from "@/lib/agentTemplates";
import { ORCHEST_PERSONAS, getPersonaByKey, DEFAULT_ROLE_BY_PERSONA } from "@/lib/personas";
import { InlineSpinner } from "@/components/InlineSpinner";

export function NewAgentForm() {
  const router = useRouter();
  const search = useSearchParams();
  const initialPersona = search.get("persona") ?? "ava";
  const [personaKey, setPersonaKey] = useState<string>(initialPersona);
  const initialRole = DEFAULT_ROLE_BY_PERSONA[initialPersona] ?? "ai_software_engineer";
  const [role, setRole] = useState(initialRole);
  const [systemPrompt, setSystemPrompt] = useState(
    getTemplateByRole(initialRole)?.defaultSystemPrompt ?? ""
  );
  const [profile, setProfile] = useState(
    getPersonaByKey(initialPersona)?.defaultPersonality ?? ""
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

        // Apply persona personality template as profile memory (if provided).
        // Best-effort: agent creation should succeed even if profile save fails.
        if (agentId && profile.trim().length > 0) {
          await fetch(`/api/agents/${agentId}/profile`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: profile }),
          }).catch(() => {});
        }

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

            // Keep personality in sync with persona template unless the user customized it.
            const currentPersona = getPersonaByKey(personaKey);
            const nextPersonaObj = getPersonaByKey(nextPersona);
            const isUsingTemplatePersonality =
              currentPersona && profile.trim() === currentPersona.defaultPersonality.trim();
            if (isUsingTemplatePersonality && nextPersonaObj) {
              setProfile(nextPersonaObj.defaultPersonality);
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
        <label className="text-sm font-medium text-zinc-900">Personality (profile memory)</label>
        <textarea
          className="min-h-[120px] w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          placeholder="How should this agent sound and behave? (tone, habits, preferences)"
        />
        <p className="text-xs text-zinc-500">
          Starts from the selected persona template. You can customize it per agent.
        </p>
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
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {loading ? <InlineSpinner className="h-4 w-4 animate-spin" /> : null}
        {loading ? "Hiring…" : "Hire persona"}
      </button>
    </form>
  );
}

