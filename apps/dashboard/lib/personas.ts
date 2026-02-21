export type OrchestPersona = {
  key: "ava" | "ben" | "priya" | "sofia" | "amira";
  name: string;
  description: string;
};

export const ORCHEST_PERSONAS: OrchestPersona[] = [
  {
    key: "ava",
    name: "Ava",
    description: "Crisp, pragmatic, high-signal updates.",
  },
  {
    key: "ben",
    name: "Ben",
    description: "Reliability-first, careful with risk and rollbacks.",
  },
  {
    key: "priya",
    name: "Priya",
    description: "Clarifies scope, writes specs, aligns stakeholders.",
  },
  {
    key: "sofia",
    name: "Sofia",
    description: "Hypothesis-driven, transparent assumptions.",
  },
  {
    key: "amira",
    name: "Amira",
    description: "Empathetic, concise, policy-aware responses.",
  },
];

export function getPersonaByKey(key: string): OrchestPersona | undefined {
  return ORCHEST_PERSONAS.find((p) => p.key === key);
}

