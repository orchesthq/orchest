import express from "express";
import { z } from "zod";
import {
  ensureDefaultAgentForClient,
  createAgent,
  deleteAgentScoped,
  getAgentByIdScoped,
  listAgentsScoped,
  listAgentMemoriesByTypeScoped,
  listAgentMemoriesScoped,
  updateAgentScoped,
} from "../db/schema";
import { addAgentMemory } from "../agent/memoryService";
import { requireInternalServiceAuth } from "../middleware/internalAuth";
import { getPersonaByKey, isPersonaKey } from "../agent/personas";

const router = express.Router();

const ROLE_TEMPLATES: Record<string, { defaultSystemPrompt: string }> = {
  ai_software_engineer: {
    defaultSystemPrompt:
      "You are an AI Software Engineer employed by the client. You complete software engineering tasks reliably, communicate clearly, and follow best practices.",
  },
  ai_devops_sre: {
    defaultSystemPrompt:
      "You are an AI DevOps / SRE employed by the client. You improve reliability, observability, deployment safety, and incident response. You are cautious with production changes and always propose a rollback plan.",
  },
  ai_product_manager: {
    defaultSystemPrompt:
      "You are an AI Product Manager employed by the client. You clarify requirements, write crisp specs, communicate trade-offs, and keep execution focused on outcomes.",
  },
  ai_data_analyst: {
    defaultSystemPrompt:
      "You are an AI Data Analyst employed by the client. You answer questions with sound analysis, highlight assumptions, and present findings clearly and accurately.",
  },
  ai_customer_support: {
    defaultSystemPrompt:
      "You are an AI Customer Support Specialist employed by the client. You resolve issues quickly, communicate empathetically, and follow the client’s policies and tone.",
  },
};

router.get("/", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const agents = await listAgentsScoped(clientId);
    res.status(200).json({ agents });
  } catch (err) {
    next(err);
  }
});

router.get("/default", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const agent = await ensureDefaultAgentForClient(clientId);
    res.status(200).json({ agent });
  } catch (err) {
    next(err);
  }
});

router.get("/:agentId", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const agentId = z.string().uuid().parse(req.params.agentId);
    const agent = await getAgentByIdScoped(clientId, agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    res.status(200).json({ agent });
  } catch (err) {
    next(err);
  }
});

router.get("/:agentId/memories", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const agentId = z.string().uuid().parse(req.params.agentId);
    const limit = z.coerce.number().int().min(1).max(100).optional().parse(req.query.limit);
    const memoryType = z
      .enum(["profile", "episodic", "semantic"])
      .optional()
      .parse(req.query.memoryType);

    const memories = memoryType
      ? await listAgentMemoriesByTypeScoped({
          clientId,
          agentId,
          memoryType,
          limit,
        })
      : await listAgentMemoriesScoped({ clientId, agentId, limit });

    res.status(200).json({ memories });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireInternalServiceAuth, async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const body = z
      .object({
        personaKey: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        role: z.string().min(1).default("ai_software_engineer"),
        systemPrompt: z.string().min(1).optional(),
      })
      .parse(req.body);

    const personaKey = body.personaKey;
    if (!personaKey && !body.name) {
      res.status(400).json({ error: "Provide either personaKey or name" });
      return;
    }
    if (personaKey && !isPersonaKey(personaKey)) {
      res.status(400).json({ error: "Invalid personaKey" });
      return;
    }

    const systemPrompt =
      body.systemPrompt ??
      ROLE_TEMPLATES[body.role]?.defaultSystemPrompt ??
      "You are an AI agent employed by the client. You complete tasks reliably, communicate clearly, and follow best practices.";

    const persona = personaKey ? getPersonaByKey(personaKey) : undefined;
    const name = persona?.name ?? body.name!;

    const agent = await createAgent({
      clientId,
      personaKey: personaKey ?? null,
      name,
      role: body.role,
      systemPrompt,
    });

    res.status(201).json({ agent });
  } catch (err) {
    // Unique violation on (client_id, persona_key) means persona already hired.
    if ((err as any)?.code === "23505") {
      res.status(409).json({ error: "This persona is already hired for your company." });
      return;
    }
    next(err);
  }
});

router.patch("/:agentId", requireInternalServiceAuth, async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const agentId = z.string().uuid().parse(req.params.agentId);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        role: z.string().min(1).optional(),
        systemPrompt: z.string().min(1).optional(),
      })
      .parse(req.body);

    const existing = await getAgentByIdScoped(clientId, agentId);
    if (!existing) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    if ((existing as any).persona_key && body.name && body.name !== existing.name) {
      res.status(400).json({ error: "Persona agent names are fixed and cannot be changed." });
      return;
    }

    const agent = await updateAgentScoped({
      clientId,
      agentId,
      name: body.name,
      role: body.role,
      systemPrompt: body.systemPrompt,
    });

    res.status(200).json({ agent });
  } catch (err) {
    next(err);
  }
});

router.delete("/:agentId", requireInternalServiceAuth, async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const agentId = z.string().uuid().parse(req.params.agentId);

    await deleteAgentScoped({ clientId, agentId });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post("/:agentId/memories", requireInternalServiceAuth, async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const agentId = z.string().uuid().parse(req.params.agentId);

    const agent = await getAgentByIdScoped(clientId, agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const body = z
      .object({
        memoryType: z.enum(["profile", "episodic", "semantic"]),
        content: z.string().min(1),
      })
      .parse(req.body);

    const memory = await addAgentMemory({
      clientId,
      agentId,
      memoryType: body.memoryType,
      content: body.content,
    });

    res.status(201).json({ memory });
  } catch (err) {
    next(err);
  }
});

export { router as agentRoutes };

