import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { techKpiPool?: Pool };
export const pool = globalForDb.techKpiPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  // Establishing several TLS connections to Neon can exceed ten seconds on a slow network.
  max: 5, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 30_000,
});
if (!globalForDb.techKpiPool) {
  attachDatabasePool(pool);
  pool.on("error", (error) => console.error("An idle database connection failed.", error.name));
}
if (process.env.NODE_ENV !== "production") globalForDb.techKpiPool = pool;
export const db = drizzle(pool, { schema });
