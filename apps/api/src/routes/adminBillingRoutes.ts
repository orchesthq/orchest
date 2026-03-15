import express from "express";
import { z } from "zod";
import {
  getClientBillingProfileOrDefault,
  insertTokenLedgerEntry,
  upsertClientBillingProfile,
} from "../db/schema";

const router = express.Router();

router.get("/profile", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const profile = await getClientBillingProfileOrDefault(clientId);
    res.status(200).json({ profile });
  } catch (err) {
    next(err);
  }
});

router.post("/grant-credits", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const body = z
      .object({
        usdMicros: z.coerce.number().int().positive(),
        note: z.string().max(500).optional(),
        metadata: z.record(z.unknown()).optional(),
      })
      .parse(req.body);

    const entry = await insertTokenLedgerEntry({
      clientId,
      entryType: "grant",
      tokens: body.usdMicros,
      note: body.note ?? "Admin grant credits",
      metadata: body.metadata ?? {},
    });
    res.status(201).json({ entry });
  } catch (err) {
    next(err);
  }
});

router.post("/adjust-credits", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const body = z
      .object({
        usdMicros: z.coerce.number().int().refine((v) => v !== 0, "usdMicros must be non-zero"),
        note: z.string().max(500).optional(),
        metadata: z.record(z.unknown()).optional(),
      })
      .parse(req.body);

    const entry = await insertTokenLedgerEntry({
      clientId,
      entryType: "adjustment",
      tokens: body.usdMicros,
      note: body.note ?? "Admin adjustment",
      metadata: body.metadata ?? {},
    });
    res.status(201).json({ entry });
  } catch (err) {
    next(err);
  }
});

router.post("/profile", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const body = z
      .object({
        markupMultiplier: z.coerce.number().positive().optional(),
        freeMonthlyUsdMicros: z.coerce.number().int().min(0).optional(),
        monthlyBudgetUsdMicros: z.coerce.number().int().min(0).optional(),
      })
      .parse(req.body);

    const profile = await upsertClientBillingProfile({
      clientId,
      markupMultiplier: body.markupMultiplier,
      freeMonthlyUsdMicros: body.freeMonthlyUsdMicros,
      monthlyBudgetUsdMicros: body.monthlyBudgetUsdMicros,
      billingMode: "usd_credits",
    });
    res.status(200).json({ profile });
  } catch (err) {
    next(err);
  }
});

export { router as adminBillingRoutes };
