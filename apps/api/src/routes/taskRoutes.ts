import express from "express";
import { z } from "zod";
import {
  createTaskForAgentScoped,
  ensureDefaultAgentForClient,
  getTaskByIdScoped,
} from "../db/schema";
import { runAgentTask } from "../agent/agentLoop";

const router = express.Router();

const createTaskSchema = z.object({
  input: z.string().min(1),
  agentId: z.string().uuid().optional(),
});

router.post("/", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const body = createTaskSchema.parse(req.body);

    const agent =
      body.agentId != null
        ? { id: body.agentId }
        : await ensureDefaultAgentForClient(clientId);

    const task = await createTaskForAgentScoped({
      clientId,
      agentId: agent.id,
      taskInput: body.input,
    });

    res.status(201).json({ task });
  } catch (err) {
    next(err);
  }
});

router.get("/:taskId", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const taskId = z.string().uuid().parse(req.params.taskId);

    const task = await getTaskByIdScoped(clientId, taskId);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.status(200).json({ task });
  } catch (err) {
    next(err);
  }
});

router.post("/:taskId/run", async (req, res, next) => {
  try {
    const clientId = req.clientId!;
    const taskId = z.string().uuid().parse(req.params.taskId);

    const task = await getTaskByIdScoped(clientId, taskId);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const result = await runAgentTask(taskId);
    res.status(200).json({ result });
  } catch (err) {
    next(err);
  }
});

export { router as taskRoutes };

