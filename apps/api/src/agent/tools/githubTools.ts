import { z } from "zod";
import { ToolRegistry, type ToolContext } from "./registry";
import { listAgentMemoriesByTypeScoped } from "../../db/schema";
import { parseEpisodicMemoryContent } from "../memoryService";
import {
  create_branch,
  create_file_and_commit,
  github_apply_patch,
  github_branch_exists,
  github_find_in_file,
  github_list_changed_files,
  github_list_tree,
  github_read_file_chunk,
  github_read_file,
  github_search_code,
  open_pull_request,
} from "../../integrations/github/githubTools";

async function findRecentRepoBranchHint(
  ctx: ToolContext,
  repo: string
): Promise<{ branch: string; repo: string } | null> {
  const repoKey = String(repo ?? "").trim().toLowerCase();
  if (!repoKey) return null;

  const episodics = await listAgentMemoriesByTypeScoped({
    clientId: ctx.clientId,
    agentId: ctx.agentId,
    memoryType: "episodic",
    limit: 120,
  }).catch(() => []);

  for (const m of episodics) {
    const parsed = parseEpisodicMemoryContent(m.content);
    if (!parsed?.artifacts?.length) continue;
    for (const a of parsed.artifacts) {
      const artifactRepo = typeof a.metadata?.repo === "string" ? String(a.metadata.repo).trim().toLowerCase() : "";
      const artifactBranch = typeof a.ref === "string" ? a.ref.trim() : "";
      if (!artifactRepo || !artifactBranch) continue;
      if (artifactRepo !== repoKey) continue;
      return { branch: artifactBranch, repo: artifactRepo };
    }
  }
  return null;
}

export function registerGitHubTools(registry: ToolRegistry): void {
  registry.register({
    name: "create_branch",
    description: "Create a new branch from a base branch in the linked GitHub repo.",
    inputSchema: z.object({
      repo: z.string().default(""),
      base: z.string().min(1).default("main"),
      branch: z.string().min(1),
    }),
    execute: async (ctx: ToolContext, args) => {
      const requestedRepo = String(args.repo ?? "").trim();
      const requestedBranch = String(args.branch ?? "").trim();
      if (requestedRepo && requestedBranch) {
        const hint = await findRecentRepoBranchHint(ctx, requestedRepo);
        if (hint && hint.branch !== requestedBranch) {
          const existsCheck = await github_branch_exists({ repo: requestedRepo, branch: hint.branch }, {
            clientId: ctx.clientId,
            agentId: ctx.agentId,
          });
          if (!existsCheck.ok) {
            // If we cannot validate the hint, do not hard-block branch creation.
            return await create_branch(args, { clientId: ctx.clientId, agentId: ctx.agentId });
          }
          const hintExists = Boolean(existsCheck.metadata && (existsCheck.metadata as any).exists === true);
          if (!hintExists) {
            // Hint is stale (branch deleted), allow creating the requested branch.
            return await create_branch(args, { clientId: ctx.clientId, agentId: ctx.agentId });
          }

          // Optional stale check: if hinted branch has no diff vs requested base, treat it as stale.
          const diffCheck = await github_list_changed_files(
            { repo: requestedRepo, base: String(args.base ?? "main"), head: hint.branch },
            { clientId: ctx.clientId, agentId: ctx.agentId }
          );
          if (diffCheck.ok) {
            const files = Array.isArray((diffCheck.metadata as any)?.files) ? ((diffCheck.metadata as any).files as any[]) : [];
            const totals = (diffCheck.metadata as any)?.totals ?? {};
            const add = Number(totals.additions ?? 0);
            const del = Number(totals.deletions ?? 0);
            if (files.length === 0 && add === 0 && del === 0) {
              return await create_branch(args, { clientId: ctx.clientId, agentId: ctx.agentId });
            }
          }

          return {
            ok: false,
            message:
              `Not executed: this agent recently worked in branch '${hint.branch}' for repo '${requestedRepo}'. ` +
              "Reuse that branch unless the user explicitly asks for a new one.",
            metadata: {
              suggestedBranch: hint.branch,
              requestedBranch,
              repo: requestedRepo,
            },
          };
        }
      }
      return await create_branch(args, { clientId: ctx.clientId, agentId: ctx.agentId });
    },
  });

  registry.register({
    name: "create_file_and_commit",
    description:
      "Create a NEW file in the linked repo on a given branch and commit the change (refuses overwrites).",
    inputSchema: z.object({
      repo: z.string().default(""),
      branch: z.string().min(1),
      path: z.string().min(1),
      content: z.string(),
      message: z.string().min(1),
    }),
    execute: async (ctx: ToolContext, args) => {
      return await create_file_and_commit(args, { clientId: ctx.clientId, agentId: ctx.agentId });
    },
  });

  registry.register({
    name: "open_pull_request",
    description: "Open a pull request from a branch into the base branch in the linked repo.",
    inputSchema: z.object({
      repo: z.string().default(""),
      branch: z.string().min(1),
      base: z.string().min(1).default("main"),
      title: z.string().min(1),
      body: z.string().optional(),
    }),
    execute: async (ctx: ToolContext, args) => {
      return await open_pull_request(args, { clientId: ctx.clientId, agentId: ctx.agentId });
    },
  });

  registry.register({
    name: "github_read_file",
    description: "Read a file from the linked GitHub repo at a given ref (branch/sha).",
    inputSchema: z.object({
      repo: z.string().default(""),
      path: z.string().min(1),
      ref: z.string().optional(),
    }),
    execute: async (ctx: ToolContext, args) => {
      return await github_read_file(args, { clientId: ctx.clientId, agentId: ctx.agentId });
    },
  });

  registry.register({
    name: "github_read_file_chunk",
    description:
      "Read a slice of a file from the linked GitHub repo by byte offset/length (use for large files).",
    inputSchema: z.object({
      repo: z.string().default(""),
      path: z.string().min(1),
      ref: z.string().optional(),
      offset: z.number().int().nonnegative().default(0),
      length: z.number().int().positive().max(200_000).default(50_000),
    }),
    execute: async (ctx: ToolContext, args) => {
      return await github_read_file_chunk(args, { clientId: ctx.clientId, agentId: ctx.agentId });
    },
  });

  registry.register({
    name: "github_find_in_file",
    description:
      "Search within a single file in the linked repo and return matching line windows and byte offsets.",
    inputSchema: z.object({
      repo: z.string().default(""),
      path: z.string().min(1),
      ref: z.string().optional(),
      needle: z.string().min(1),
      caseInsensitive: z.boolean().optional(),
      contextLines: z.number().int().nonnegative().max(50).optional(),
      maxMatches: z.number().int().positive().max(50).optional(),
    }),
    execute: async (ctx: ToolContext, args) => {
      return await github_find_in_file(args, { clientId: ctx.clientId, agentId: ctx.agentId });
    },
  });

  registry.register({
    name: "github_list_tree",
    description: "List files/directories in the linked GitHub repo at a ref (optionally under a path).",
    inputSchema: z.object({
      repo: z.string().default(""),
      ref: z.string().optional(),
      pathPrefix: z.string().optional(),
      recursive: z.boolean().optional(),
    }),
    execute: async (ctx: ToolContext, args) => {
      return await github_list_tree(args, { clientId: ctx.clientId, agentId: ctx.agentId });
    },
  });

  registry.register({
    name: "github_search_code",
    description: "Search code in the linked GitHub repo. Returns top matching paths.",
    inputSchema: z.object({
      repo: z.string().default(""),
      query: z.string().min(1),
    }),
    execute: async (ctx: ToolContext, args) => {
      return await github_search_code(args, { clientId: ctx.clientId, agentId: ctx.agentId });
    },
  });

  registry.register({
    name: "github_apply_patch",
    description: "Apply a unified diff patch to one or more files and commit the result (safer than overwriting).",
    inputSchema: z.object({
      repo: z.string().default(""),
      branch: z.string().min(1),
      patch: z.string().min(1),
      message: z.string().min(1),
    }),
    execute: async (ctx: ToolContext, args) => {
      return await github_apply_patch(args, { clientId: ctx.clientId, agentId: ctx.agentId });
    },
  });

  registry.register({
    name: "github_list_changed_files",
    description:
      "List changed files between two refs/commits (use before opening PRs to sanity-check scope).",
    inputSchema: z.object({
      repo: z.string().default(""),
      base: z.string().min(1),
      head: z.string().min(1),
    }),
    execute: async (ctx: ToolContext, args) => {
      return await github_list_changed_files(args, { clientId: ctx.clientId, agentId: ctx.agentId });
    },
  });
}

