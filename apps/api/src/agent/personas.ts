export type OrchestPersona = {
  key: "ava" | "ben" | "priya" | "sofia" | "amira";
  name: string; // fixed display name
  description: string;
};

export const ORCHEST_PERSONAS: OrchestPersona[] = [
  {
    key: "ava",
    name: "Ava",
    description: "Crisp, pragmatic, high-signal updates. Default: Software Engineer.",
  },
  {
    key: "ben",
    name: "Ben",
    description: "Reliability-first, careful with risk. Default: DevOps/SRE.",
  },
  {
    key: "priya",
    name: "Priya",
    description: "Clarifies scope, writes specs, aligns stakeholders. Default: Product Manager.",
  },
  {
    key: "sofia",
    name: "Sofia",
    description: "Hypothesis-driven, transparent assumptions. Default: Data Analyst.",
  },
  {
    key: "amira",
    name: "Amira",
    description: "Empathetic, concise, policy-aware. Default: Customer Support.",
  },
];

export function isPersonaKey(key: string): key is OrchestPersona["key"] {
  return ORCHEST_PERSONAS.some((p) => p.key === key);
}

export function getPersonaByKey(key: string): OrchestPersona | undefined {
  return ORCHEST_PERSONAS.find((p) => p.key === key);
}

