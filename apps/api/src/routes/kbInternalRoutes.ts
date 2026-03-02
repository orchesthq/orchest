import express from "express";
import { z } from "zod";
import { kbSearch } from "../kb/kbService";
import { syncGitHubRepoToKb } from "../kb/githubSync";
import { listKbSourcesByClientId } from "../db/schema";

const router = express.Router();

router.get("/sources", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const sources = await listKbSourcesByClientId(clientId);
    res.status(200).json({ sources });
  } catch (err) {
    next(err);
  }
});

router.get("/search", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const q = z.string().min(2).parse(req.query.q);
    const repo = z.string().min(1).optional().parse(req.query.repo ?? undefined);
    const pathPrefix = z.string().min(1).optional().parse(req.query.pathPrefix ?? undefined);
    const limit = z.coerce.number().int().min(1).max(20).optional().parse(req.query.limit ?? undefined);

    const results = await kbSearch({ clientId, query: q, repoFullName: repo, pathPrefix, limit });
    res.status(200).json({ results });
  } catch (err) {
    next(err);
  }
});

router.post("/sync/github", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const body = z
      .object({
        repoFullName: z.string().min(3),
        ref: z.string().min(1).optional(),
        paths: z.array(z.string().min(1)).optional(),
        maxFiles: z.number().int().min(1).max(2000).optional(),
      })
      .parse(req.body ?? {});

    const out = await syncGitHubRepoToKb({
      clientId,
      repoFullName: body.repoFullName,
      ref: body.ref,
      paths: body.paths,
      maxFiles: body.maxFiles,
    });
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
});

export { router as kbInternalRoutes };

