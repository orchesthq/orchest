import express from "express";
import { z } from "zod";
import { getBillingBalanceSummaryScoped, listTokenLedgerEntriesScoped } from "../db/schema";

const router = express.Router();

router.get("/balance", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const summary = await getBillingBalanceSummaryScoped(clientId);
    res.status(200).json({
      balanceUsdMicros: summary.balanceUsdMicros,
      monthSpendUsdMicros: summary.monthSpendUsdMicros,
      monthCreditsUsdMicros: summary.monthCreditsUsdMicros,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/ledger", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const parsed = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).optional(),
        beforeCreatedAt: z.string().datetime().optional(),
      })
      .parse(req.query);

    const entries = await listTokenLedgerEntriesScoped({
      clientId,
      limit: parsed.limit,
      beforeCreatedAt: parsed.beforeCreatedAt,
    });
    res.status(200).json({ entries });
  } catch (err) {
    next(err);
  }
});

export { router as billingRoutes };
