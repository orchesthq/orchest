# Orchest Roadmap

## Company context & knowledge

**Goal:** Give agents knowledge of the company so they can answer questions and act with context.

### Approaches

1. **Semantic memory + RAG**
   - Store company docs, wiki pages, internal links as `agent_memories` (type: `semantic`)
   - Use embeddings (pgvector) for retrieval; inject retrieved chunks into the planning prompt
   - Users can “train” the AI by sending links: e.g. “Remember this: https://…”; backend fetches, chunks, embeds, stores

2. **Document ingestion pipeline**
   - Dashboard: “Add company context” → paste URL or upload file
   - Backend: fetch/scrape, chunk (e.g. 500–1000 tokens), embed, upsert into `agent_memories` or a `company_documents` table
   - Agent loop: before planning, run RAG query over company docs + episodic memory

3. **Per-client knowledge base**
   - Table: `company_documents(client_id, url, title, content_embedding, chunks…)`
   - Scope all RAG by `client_id` so each company’s context is isolated

### Implementation sketch

- Add `pgvector` to Postgres (Supabase supports it)
- `services/embeddingService.ts` – call OpenAI (or compatible) embeddings API
- `services/ragService.ts` – query similar chunks, merge into prompt
- Dashboard: “Context” section per agent/client to add URLs or paste content
- Agent loop: inject RAG results into `createPlan` and `summarizeResults` context

---

## Tooling (GitHub, Jira, Confluence)

**Goal:** Agents can take real actions: update code, create/update Jira issues, edit Confluence pages.

**Design:** See [docs/GITHUB_INTEGRATION_DESIGN.md](./docs/GITHUB_INTEGRATION_DESIGN.md) for the full GitHub integration design: dashboard connect flow, access levels (read-only / PR-only / direct push), repo selection, and implementation phases.

### Dogfooding: Orchest with Orchest

Develop Orchest using its own AI agents:

1. **GitHub**
   - GitHub App install + per-agent connections are implemented (including multi-repo linking and guardrails against “crappy PRs”).
   - Next: add more end-to-end tests around the GitHub flows and tighten the PR “review gate” UX (show changed files summary before opening PR).

2. **Jira**
   - New integration: `integrations/jira/` – create issue, update status, add comment
   - OAuth or API token per client; store in `integrations` or env
   - Tool schema: `create_jira_issue`, `update_jira_issue`, `add_jira_comment`
   - Agent loop: extend `simulateStep` (or a proper tool router) to dispatch to Jira tools

3. **Confluence**
   - Similar pattern: create/update page, search spaces
   - Tools: `create_confluence_page`, `update_confluence_page`, `search_confluence`

### Architecture

- **Tool router:** One place (e.g. `agentLoop.ts` or `toolRouter.ts`) that maps plan steps → tool calls
- **Tool definitions:** Each integration exposes `{ name, description, parameters, execute }`
- **Planner prompt:** Include available tools and when to use them; planner outputs structured steps like `create_pr(repo, branch, title)`

### Suggested order

1. Harden/expand GitHub tools (more guardrails + tests)
2. Use Orchest repo as the first “dogfood” target (end-to-end)
3. Add Jira – create issues for tasks, link PRs
4. Add Confluence – document designs and decisions

---

## Agent UX (quality + autonomy)

- **Clarify-first behavior**: only ask questions when input is ambiguous or a clear choice is required; otherwise proceed.
- **Document outputs**: prefer publishing long-form outputs to Slack Canvas (or other docs backends later), with a short conversational Slack message + link.
- **Browsing**: add an explicit “web fetch/search” tool if agents need to reference external sites reliably (don’t rely on the model “just browsing”).
