import express from "express";
import { z } from "zod";
import { createLlmPricingRate, listLlmPricingRates } from "../db/schema";

const router = express.Router();

router.get("/rates", async (req, res, next) => {
  try {
    const q = z
      .object({
        provider: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
        operation: z.string().min(1).optional(),
        active: z
          .union([z.literal("true"), z.literal("false")])
          .optional()
          .transform((v) => (v == null ? undefined : v === "true")),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(req.query);

    const rates = await listLlmPricingRates({
      provider: q.provider,
      model: q.model,
      operation: q.operation,
      active: q.active,
      limit: q.limit,
    });
    res.status(200).json({ rates });
  } catch (err) {
    next(err);
  }
});

router.post("/rates", async (req, res, next) => {
  try {
    const body = z
      .object({
        provider: z.string().min(1),
        model: z.string().min(1),
        operation: z.string().min(1),
        tokenType: z.enum(["input", "output"]),
        usdPer1mTokensMicros: z.coerce.number().int().min(0),
        pricingVersion: z.string().min(1).optional(),
        effectiveFrom: z.string().datetime().optional(),
        effectiveTo: z.string().datetime().nullable().optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);

    const rate = await createLlmPricingRate({
      provider: body.provider,
      model: body.model,
      operation: body.operation,
      tokenType: body.tokenType,
      usdPer1mTokensMicros: body.usdPer1mTokensMicros,
      pricingVersion: body.pricingVersion,
      effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined,
      effectiveTo: body.effectiveTo == null ? undefined : new Date(body.effectiveTo),
      active: body.active,
    });
    res.status(201).json({ rate });
  } catch (err) {
    next(err);
  }
});

export { router as adminPricingRoutes };
