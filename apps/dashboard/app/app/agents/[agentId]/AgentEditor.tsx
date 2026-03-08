"use client";

import { useMemo, useState } from "react";
import { AGENT_TEMPLATES, getTemplateByRole } from "@/lib/agentTemplates";
import { getPersonaByKey } from "@/lib/personas";
import { InlineSpinner } from "@/components/InlineSpinner";

type Props = {
  agentId: string;
  personaKey: string | null;
  initialName: string;
  initialRole: string;
  initialSystemPrompt: string;
  initialProfileMemory: string;
};

export function AgentEditor(props: Props) {
  const [name, setName] = useState(props.initialName);
  const [role, setRole] = useState(props.initialRole);
  const [systemPrompt, setSystemPrompt] = useState(props.initialSystemPrompt);
  const [profile, setProfile] = useState(props.initialProfileMemory);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const dirty = useMemo(() => {
    return (
      (props.personaKey ? false : name !== props.initialName) ||
      role !== props.initialRole ||
      systemPrompt !== props.initialSystemPrompt ||
      profile !== props.initialProfileMemory
    );
  }, [
    name,
    role,
    systemPrompt,
    profile,
    props.personaKey,
    props.initialName,
    props.initialRole,
    props.initialSystemPrompt,
    props.initialProfileMemory,
  ]);

  return (
    <form
      className="space-y-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSavedAt(null);

        try {
          if (
            (!props.personaKey && name !== props.initialName) ||
            role !== props.initialRole ||
            systemPrompt !== props.initialSystemPrompt
          ) {
            const res = await fetch(`/api/agents/${props.agentId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: !props.personaKey && name !== props.initialName ? name : undefined,
                role: role !== props.initialRole ? role : undefined,
                systemPrompt: systemPrompt !== props.initialSystemPrompt ? systemPrompt : undefined,
              }),
            });
            if (!res.ok) throw new Error("Failed to update agent");
          }

          if (profile.trim().length > 0 && profile !== props.initialProfileMemory) {
            const res = await fetch(`/api/agents/${props.agentId}/profile`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: profile }),
            });
            if (!res.ok) throw new Error("Failed to save personality");
          }

          setSavedAt(new Date().toLocaleString());
        } catch (err: any) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setLoading(false);
        }
      }}
    >
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-900">Name</label>
          <input
            className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={Boolean(props.personaKey)}
          />
          <p className="text-xs text-zinc-500">
            {props.personaKey ? "Persona name is fixed." : "Custom agent name."}
          </p>
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
            Saved as a persistent profile memory; the latest entry is used as “current personality”.
          </p>

          {props.personaKey ? (
            <button
              type="button"
              className="text-xs font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900"
              onClick={() => {
                const persona = getPersonaByKey(props.personaKey);
                if (!persona) return;

                const isUsingTemplate = profile.trim() === persona.defaultPersonality.trim();
                if (isUsingTemplate) return;
                setProfile(persona.defaultPersonality);
              }}
            >
              Reset to persona template
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-900">Role</label>
        <select
          className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
          value={role}
          onChange={(e) => {
            const nextRole = e.target.value;
            setRole(nextRole);

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
        <p className="text-xs text-zinc-500">Role can be changed without changing the persona name.</p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-900">System prompt</label>
        <textarea
          className="min-h-[160px] w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
        />
        <p className="text-xs text-zinc-500">
          This defines the agent’s core behavior. Keep it stable; use personality for style.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {savedAt && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Saved at {savedAt}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !dirty}
        className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {loading ? <InlineSpinner className="h-4 w-4 animate-spin" /> : null}
        {loading ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

