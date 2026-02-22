import { z } from "zod";
import { ToolRegistry, type ToolContext } from "./registry";
import {
  create_branch,
  create_file_and_commit,
  github_list_tree,
  github_read_file,
  github_search_code,
  open_pull_request,
} from "../../integrations/github/githubTools";

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
      return await create_branch(args, { clientId: ctx.clientId, agentId: ctx.agentId });
    },
  });

  registry.register({
    name: "create_file_and_commit",
    description:
      "Create or overwrite a file in the linked repo on a given branch and commit the change.",
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
}

