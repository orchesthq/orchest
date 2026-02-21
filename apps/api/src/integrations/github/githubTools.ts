export type GitHubToolResult = {
  ok: boolean;
  message: string;
  metadata?: Record<string, unknown>;
};

export async function create_branch(input: {
  repo: string;
  base: string;
  branch: string;
}): Promise<GitHubToolResult> {
  console.log("[github] create_branch", input);
  return {
    ok: true,
    message: `Mocked: would create branch '${input.branch}' from '${input.base}' in '${input.repo}'.`,
    metadata: input,
  };
}

export async function commit_changes(input: {
  repo: string;
  branch: string;
  message: string;
}): Promise<GitHubToolResult> {
  console.log("[github] commit_changes", input);
  return {
    ok: true,
    message: `Mocked: would commit changes on '${input.branch}' in '${input.repo}' with message '${input.message}'.`,
    metadata: input,
  };
}

export async function open_pull_request(input: {
  repo: string;
  branch: string;
  base: string;
  title: string;
  body?: string;
}): Promise<GitHubToolResult> {
  console.log("[github] open_pull_request", input);
  return {
    ok: true,
    message: `Mocked: would open PR from '${input.branch}' into '${input.base}' in '${input.repo}' titled '${input.title}'.`,
    metadata: input,
  };
}

