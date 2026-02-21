import { Pool, type QueryResultRow } from "pg";

export class DbNotConfiguredError extends Error {
  constructor(message = "DATABASE_URL is not configured") {
    super(message);
    this.name = "DbNotConfiguredError";
  }
}

let _pool: Pool | null = null;

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new DbNotConfiguredError();
  if (_pool) return _pool;

  const connectionString = process.env.DATABASE_URL;
  const url = new URL(connectionString);
  const isSupabaseHost =
    url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".supabase.com");

  // Supabase Postgres requires TLS. `pg` does not auto-enable SSL just because the
  // URL is `postgresql://...`, so we turn it on by default for Supabase hosts.
  // (If you use local Postgres, it will continue to work without SSL.)
  _pool = new Pool({
    connectionString,
    ssl: isSupabaseHost ? { rejectUnauthorized: false } : undefined,
  });

  _pool.on("error", (err: unknown) => {
    // Keep server alive; surface the error for observability.
    console.error("[db] unexpected pool error", err);
  });

  return _pool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<{ rows: T[] }> {
  const pool = getPool();
  return await pool.query<T>(text, params);
}

export async function pingDb(): Promise<void> {
  await query("select 1 as ok");
}

