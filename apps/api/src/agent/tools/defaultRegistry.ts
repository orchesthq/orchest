import { ToolRegistry } from "./registry";
import { registerGitHubTools } from "./githubTools";
import { z } from "zod";

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register({
    name: "noop",
    description: "Do nothing (used for mocked planning / dry runs).",
    inputSchema: z.object({
      reason: z.string().optional(),
    }),
    execute: async (_ctx, args) => {
      return {
        ok: false,
        message: args.reason ? `Not executed: ${args.reason}` : "Not executed: noop",
      };
    },
  });

  registerGitHubTools(registry);
  return registry;
}

