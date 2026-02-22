function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:3000";
}

function internalSecret(): string {
  const s = process.env.INTERNAL_SERVICE_SECRET;
  if (!s) throw new Error("INTERNAL_SERVICE_SECRET is not configured for dashboard");
  return s;
}

export async function apiFetchForClient<T>(
  clientId: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      "x-client-id": clientId,
      "x-internal-secret": internalSecret(),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }

  // Some endpoints return 204 No Content (e.g. DELETE). Avoid JSON parse errors.
  if (res.status === 204) return null as unknown as T;

  const text = await res.text().catch(() => "");
  if (!text) return null as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`API error: expected JSON but got: ${text.slice(0, 300)}`);
  }
}

