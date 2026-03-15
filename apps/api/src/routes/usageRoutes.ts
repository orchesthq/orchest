import express from "express";
import { z } from "zod";
import { getTokenUsageSummaryScoped, listLlmModelCatalog, listTokenUsageEventsScoped } from "../db/schema";

const router = express.Router();

const filtersSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  agentId: z.string().uuid().optional(),
  model: z.string().min(1).optional(),
  modelGroup: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  operation: z.string().min(1).optional(),
});

router.get("/summary", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const parsed = filtersSchema
      .extend({
        groupBy: z.enum(["day", "model", "agent", "operation"]).optional(),
      })
      .parse(req.query);

    const summary = await getTokenUsageSummaryScoped({
      clientId,
      from: parsed.from,
      to: parsed.to,
      agentId: parsed.agentId,
      model: parsed.model,
      modelGroup: parsed.modelGroup,
      provider: parsed.provider,
      operation: parsed.operation,
      groupBy: parsed.groupBy,
    });
    res.status(200).json(summary);
  } catch (err) {
    next(err);
  }
});

router.get("/events", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const parsed = filtersSchema
      .extend({
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(req.query);

    const events = await listTokenUsageEventsScoped({
      clientId,
      from: parsed.from,
      to: parsed.to,
      agentId: parsed.agentId,
      model: parsed.model,
      modelGroup: parsed.modelGroup,
      provider: parsed.provider,
      operation: parsed.operation,
      limit: parsed.limit,
      offset: parsed.offset,
    });
    res.status(200).json({ events });
  } catch (err) {
    next(err);
  }
});

router.get("/filter-options", async (_req, res, next) => {
  try {
    const rows = await listLlmModelCatalog({ active: true });
    const providers = Array.from(new Set(rows.map((r) => r.provider))).sort((a, b) => a.localeCompare(b));
    const modelGroups = Array.from(new Set(rows.map((r) => r.model_group))).sort((a, b) => a.localeCompare(b));
    res.status(200).json({ providers, modelGroups });
  } catch (err) {
    next(err);
  }
});

export { router as usageRoutes };
