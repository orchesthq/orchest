import express from "express";
import { z } from "zod";
import {
  createClient,
  createClientMembership,
  getClientById,
  listClientMembershipsByUserId,
  ensureDefaultAgentForClient,
} from "../db/schema";

const router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    const body = z
      .object({
        name: z.string().min(1),
        createDefaultAgent: z.boolean().optional(),
        defaultAgentName: z.string().min(1).optional(),
      })
      .parse(req.body);

    const client = await createClient(body.name);

    const shouldCreateDefaultAgent = body.createDefaultAgent ?? false;
    const defaultAgent = shouldCreateDefaultAgent
      ? await ensureDefaultAgentForClient(client.id, body.defaultAgentName)
      : null;

    res.status(201).json({ client, defaultAgent });
  } catch (err) {
    next(err);
  }
});

router.get("/:clientId", async (req, res, next) => {
  try {
    const clientId = z.string().uuid().parse(req.params.clientId);
    const client = await getClientById(clientId);
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    res.status(200).json({ client });
  } catch (err) {
    next(err);
  }
});

router.post("/memberships", async (req, res, next) => {
  try {
    const body = z
      .object({
        clientId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.string().min(1).default("owner"),
      })
      .parse(req.body);

    const membership = await createClientMembership({
      clientId: body.clientId,
      userId: body.userId,
      role: body.role,
    });

    res.status(201).json({ membership });
  } catch (err) {
    next(err);
  }
});

router.get("/users/:userId/memberships", async (req, res, next) => {
  try {
    const userId = z.string().uuid().parse(req.params.userId);
    const memberships = await listClientMembershipsByUserId(userId);
    res.status(200).json({ memberships });
  } catch (err) {
    next(err);
  }
});

export { router as clientRoutes };

