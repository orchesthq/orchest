import { Pool, type QueryResultRow } from "pg";

let _pool: Pool | null = null;

function buildPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured for dashboard");

  const url = new URL(connectionString);
  const isSupabaseHost =
    url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".supabase.com");

  return new Pool({
    connectionString,
    ssl: isSupabaseHost ? { rejectUnauthorized: false } : undefined,
  });
}

export function getPool(): Pool {
  // Avoid recreating pools during dev hot-reload.
  if (_pool) return _pool;
  _pool = buildPool();
  _pool.on("error", (err) => console.error("[dashboard-db] pool error", err));
  return _pool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<{ rows: T[] }> {
  return await getPool().query<T>(text, params);
}

