import { Pool, PoolClient, QueryResult } from "pg";
import { env } from "../config/env";
import { logger } from "../services/logger";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 30_000,
    });

    pool.on("error", (err) => {
      logger.error({ message: "Unexpected PostgreSQL pool error", error: String(err) });
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Execute a query within a tenant-scoped context.
 * Sets the RLS session variable `app.current_tenant_id` so PostgreSQL
 * row-level security policies enforce isolation even if the app layer
 * forgets a WHERE clause.
 */
export async function tenantQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  tenantId: string,
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const client = await getPool().connect();
  try {
    await client.query("SET LOCAL app.current_tenant_id = $1", [tenantId]);
    return await client.query<T>(text, params);
  } finally {
    client.release();
  }
}

/**
 * Execute multiple queries within a single tenant-scoped transaction.
 * The callback receives a client with RLS already configured.
 */
export async function tenantTransaction<T>(
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL app.current_tenant_id = $1", [tenantId]);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Super-admin query without tenant scoping (for platform-level operations).
 * Use sparingly — this bypasses RLS.
 */
export async function superQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/**
 * Health check for the PostgreSQL connection.
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const result = await getPool().query("SELECT 1 AS ok");
    return result.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}
