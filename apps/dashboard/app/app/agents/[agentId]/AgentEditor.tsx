"use client";

import { useMemo, useState } from "react";
import { AGENT_TEMPLATES, getTemplateByRole } from "@/lib/agentTemplates";
import { ORCHEST_PERSONAS, getPersonaByKey } from "@/lib/personas";
import { InlineSpinner } from "@/components/InlineSpinner";

type Props = {
  agentId: string;
  personaKey: string | null;
  initialName: string;
  initialRole: string;
  initialSystemPrompt: string;
  initialLlmProvider: string;
  initialLlmModel: string;
  modelOptions: Array<{
    id: string;
    provider: string;
    model_group: string;
    model_specific: string;
    active: boolean;
  }>;
  initialProfileMemory: string;
};

export function AgentEditor(props: Props) {
  const [name, setName] = useState(props.initialName);
  const [role, setRole] = useState(props.initialRole);
  const [systemPrompt, setSystemPrompt] = useState(props.initialSystemPrompt);
  const [llmProvider, setLlmProvider] = useState(props.initialLlmProvider);
  const [llmModel, setLlmModel] = useState(props.initialLlmModel);
  const [profile, setProfile] = useState(props.initialProfileMemory);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [personaKey, setPersonaKey] = useState<string | null>(props.personaKey);

  // Local baselines so the editor doesn't "snap back" to the original props after saving.
  // (The page doesn't automatically refetch server props after a PATCH.)
  const [baselinePersonaKey, setBaselinePersonaKey] = useState<string | null>(props.personaKey);
  const [baselineName, setBaselineName] = useState(props.initialName);
  const [baselineRole, setBaselineRole] = useState(props.initialRole);
  const [baselineSystemPrompt, setBaselineSystemPrompt] = useState(props.initialSystemPrompt);
  const [baselineLlmProvider, setBaselineLlmProvider] = useState(props.initialLlmProvider);
  const [baselineLlmModel, setBaselineLlmModel] = useState(props.initialLlmModel);
  const [baselineProfile, setBaselineProfile] = useState(props.initialProfileMemory);

  const persona = useMemo(() => {
    if (!personaKey) return undefined;
    return getPersonaByKey(personaKey);
  }, [personaKey]);

  const personaIsCustom = useMemo(() => {
    if (!persona) return false;
    return profile.trim() !== persona.defaultPersonality.trim();
  }, [persona, profile]);

  const roleTemplate = useMemo(() => getTemplateByRole(role), [role]);
  const modelOptionsForProvider = useMemo(
    () =>
      props.modelOptions
        .filter((m) => m.active && m.provider === llmProvider)
        .sort((a, b) => {
          if (a.model_group !== b.model_group) return a.model_group.localeCompare(b.model_group);
          return a.model_specific.localeCompare(b.model_specific);
        }),
    [props.modelOptions, llmProvider]
  );
  const modelGrouped = useMemo(() => {
    const grouped = new Map<string, Array<{ model_specific: string }>>();
    for (const m of modelOptionsForProvider) {
      const arr = grouped.get(m.model_group) ?? [];
      arr.push({ model_specific: m.model_specific });
      grouped.set(m.model_group, arr);
    }
    return Array.from(grouped.entries());
  }, [modelOptionsForProvider]);
  const roleIsCustom = useMemo(() => {
    if (!roleTemplate) return false;
    return systemPrompt.trim() !== roleTemplate.defaultSystemPrompt.trim();
  }, [roleTemplate, systemPrompt]);

  const dirty = useMemo(() => {
    return (
      personaKey !== baselinePersonaKey ||
      (baselinePersonaKey ? false : name !== baselineName) ||
      role !== baselineRole ||
      systemPrompt !== baselineSystemPrompt ||
      llmProvider !== baselineLlmProvider ||
      llmModel !== baselineLlmModel ||
      profile !== baselineProfile
    );
  }, [
    name,
    role,
    systemPrompt,
    profile,
    personaKey,
    baselinePersonaKey,
    baselineName,
    baselineRole,
    baselineSystemPrompt,
    llmProvider,
    llmModel,
    baselineLlmProvider,
    baselineLlmModel,
    baselineProfile,
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
            personaKey !== baselinePersonaKey ||
            (!baselinePersonaKey && name !== baselineName) ||
            role !== baselineRole ||
            systemPrompt !== baselineSystemPrompt ||
            llmProvider !== baselineLlmProvider ||
            llmModel !== baselineLlmModel
          ) {
            const res = await fetch(`/api/agents/${props.agentId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: !baselinePersonaKey && name !== baselineName ? name : undefined,
                personaKey: personaKey !== baselinePersonaKey ? personaKey : undefined,
                role: role !== baselineRole ? role : undefined,
                systemPrompt: systemPrompt !== baselineSystemPrompt ? systemPrompt : undefined,
                llmProvider: llmProvider !== baselineLlmProvider ? llmProvider : undefined,
                llmModel: llmModel !== baselineLlmModel ? llmModel : undefined,
              }),
            });
            if (!res.ok) throw new Error("Failed to update agent");
          }

          if (profile.trim().length > 0 && profile !== baselineProfile) {
            const res = await fetch(`/api/agents/${props.agentId}/profile`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: profile }),
            });
            if (!res.ok) throw new Error("Failed to save personality");
          }

          // Update baselines so the UI reflects what was just saved.
          setBaselinePersonaKey(personaKey);
          setBaselineName(name);
          setBaselineRole(role);
          setBaselineSystemPrompt(systemPrompt);
          setBaselineLlmProvider(llmProvider);
          setBaselineLlmModel(llmModel);
          setBaselineProfile(profile);

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
          <label className="text-sm font-medium text-zinc-900">Persona</label>
          <select
            className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
            value={personaKey ?? ""}
            onChange={(e) => {
              const nextKey = e.target.value;
              setPersonaKey(nextKey);

              // Always re-apply the selected persona template.
              const nextPersona = getPersonaByKey(nextKey);
              if (nextPersona) setProfile(nextPersona.defaultPersonality);
            }}
          >
            {ORCHEST_PERSONAS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.description}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500">
            Changing persona will overwrite the personality text with the selected persona template.
          </p>

          <label className="text-sm font-medium text-zinc-900">
            Personality (profile memory)
            {personaIsCustom ? (
              <span className="ml-2 text-xs font-normal text-zinc-500">(custom)</span>
            ) : null}
          </label>
          <textarea
            className="min-h-[120px] w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            placeholder="How should this agent sound and behave? (tone, habits, preferences)"
          />
          <p className="text-xs text-zinc-500">
            Saved as a persistent profile memory; the latest entry is used as “current personality”.
          </p>

          {persona ? (
            <button
              type="button"
              disabled={!personaIsCustom}
              className="text-xs font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                if (!personaIsCustom) return;
                setProfile(persona.defaultPersonality);
              }}
            >
              Reset to persona template
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-900">
          Role
          {roleIsCustom ? <span className="ml-2 text-xs font-normal text-zinc-500">(custom)</span> : null}
        </label>
        <select
          className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
          value={role}
          onChange={(e) => {
            const nextRole = e.target.value;
            setRole(nextRole);

            // Always re-apply the selected role template.
            const nextTemplate = getTemplateByRole(nextRole);
            if (nextTemplate) setSystemPrompt(nextTemplate.defaultSystemPrompt);
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

        {roleTemplate ? (
          <button
            type="button"
            disabled={!roleIsCustom}
            className="text-xs font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              if (!roleIsCustom) return;
              setSystemPrompt(roleTemplate.defaultSystemPrompt);
            }}
          >
            Reset to role template
          </button>
        ) : null}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-900">Model</label>
        <select
          className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
          value={llmModel}
          onChange={(e) => {
            const nextModel = e.target.value;
            setLlmModel(nextModel);
            const selected = props.modelOptions.find((m) => m.model_specific === nextModel);
            if (selected) setLlmProvider(selected.provider);
          }}
        >
          {modelGrouped.length === 0 ? (
            <option value={llmModel}>{llmModel}</option>
          ) : (
            modelGrouped.map(([group, models]) => (
              <optgroup key={group} label={group}>
                {models.map((m) => (
                  <option key={m.model_specific} value={m.model_specific}>
                    {m.model_specific}
                  </option>
                ))}
              </optgroup>
            ))
          )}
        </select>
        <p className="text-xs text-zinc-500">
          This agent will execute LLM calls with the selected model.
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

