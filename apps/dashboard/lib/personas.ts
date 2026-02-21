export type OrchestPersona = {
  key: "ava" | "ben" | "priya" | "sofia" | "amira";
  name: string;
  description: string;
  /** Path to avatar image in /agents/{key}.png */
  imagePath: string;
};

export const ORCHEST_PERSONAS: OrchestPersona[] = [
  {
    key: "ava",
    name: "Ava",
    description: "Crisp, pragmatic, high-signal updates.",
    imagePath: "/agents/ava.png",
  },
  {
    key: "ben",
    name: "Ben",
    description: "Reliability-first, careful with risk and rollbacks.",
    imagePath: "/agents/ben.png",
  },
  {
    key: "priya",
    name: "Priya",
    description: "Clarifies scope, writes specs, aligns stakeholders.",
    imagePath: "/agents/priya.png",
  },
  {
    key: "sofia",
    name: "Sofia",
    description: "Hypothesis-driven, transparent assumptions.",
    imagePath: "/agents/sofia.png",
  },
  {
    key: "amira",
    name: "Amira",
    description: "Empathetic, concise, policy-aware responses.",
    imagePath: "/agents/amira.png",
  },
];

export function getPersonaByKey(key: string): OrchestPersona | undefined {
  return ORCHEST_PERSONAS.find((p) => p.key === key);
}

export const DEFAULT_ROLE_BY_PERSONA: Record<string, string> = {
  ava: "ai_software_engineer",
  ben: "ai_devops_sre",
  priya: "ai_product_manager",
  sofia: "ai_data_analyst",
  amira: "ai_customer_support",
};

