import { z } from "zod";
import { ToolRegistry, type ToolContext } from "./registry";
import { kbSearch } from "../../kb/kbService";

export function registerKbTools(registry: ToolRegistry): void {
  registry.register({
    name: "kb_search",
    description:
      "Search the company knowledge base (code/docs chunks) and return the most relevant snippets with file + line ranges.",
    inputSchema: z.object({
      query: z.string().min(2),
      repo: z.string().optional(),
      pathPrefix: z.string().optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    execute: async (ctx: ToolContext, args) => {
      const results = await kbSearch({
        clientId: ctx.clientId,
        query: args.query,
        repoFullName: args.repo,
        pathPrefix: args.pathPrefix,
        limit: args.limit,
      });
      if (results.length === 0) {
        return {
          ok: false,
          message:
            "No KB results. Either the KB has not been synced yet, or embeddings are not configured (partner_settings(openai/default)).",
          metadata: { results: [] },
        };
      }
      return {
        ok: true,
        message: `Found ${results.length} KB snippet(s).`,
        metadata: { results },
      };
    },
  });
}

