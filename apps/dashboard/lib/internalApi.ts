import { z } from "zod";

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:3000";
}

function internalSecret(): string {
  const s = process.env.INTERNAL_SERVICE_SECRET;
  if (!s) throw new Error("INTERNAL_SERVICE_SECRET is not configured for dashboard");
  return s;
}

export async function apiCreateClient(input: {
  name: string;
  createDefaultAgent?: boolean;
  defaultAgentName?: string;
}): Promise<{ clientId: string; defaultAgentId: string | null }> {
  const res = await fetch(`${apiBaseUrl()}/internal/clients`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": internalSecret(),
    },
    body: JSON.stringify(input),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`API create client failed: ${res.status}`);
  const json = await res.json();

  const parsed = z
    .object({
      client: z.object({ id: z.string().uuid() }),
      defaultAgent: z.object({ id: z.string().uuid() }).nullable(),
    })
    .parse(json);

  return { clientId: parsed.client.id, defaultAgentId: parsed.defaultAgent?.id ?? null };
}

export async function apiCreateMembership(input: {
  clientId: string;
  userId: string;
  role?: string;
}): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/internal/clients/memberships`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": internalSecret(),
    },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API create membership failed: ${res.status}`);
}

export async function apiGetClientById(input: { clientId: string }): Promise<{ id: string; name: string }> {
  const res = await fetch(`${apiBaseUrl()}/internal/clients/${input.clientId}`, {
    method: "GET",
    headers: {
      "x-internal-secret": internalSecret(),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API get client failed: ${res.status}`);
  const json = await res.json();
  const parsed = z
    .object({
      client: z.object({
        id: z.string().uuid(),
        name: z.string(),
      }),
    })
    .parse(json);
  return parsed.client;
}

