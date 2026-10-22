/** Apply the versioned app migrations (0002 onwards) to an existing installation, in order. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { config } from 'dotenv';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

config({ path: process.env.KPI_MIGRATION_ENV ?? '.env.local', quiet: true });

async function main() {
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')) as { entries: { idx: number; tag: string }[] };
  const tags = journal.entries.filter(entry => entry.idx >= 2).sort((a, b) => a.idx - b.idx).map(entry => entry.tag);
  if (!tags.length || tags.some(tag => !/^\d{4}_[a-z0-9_]+$/.test(tag))) throw new Error('The versioned app migrations are missing.');
  const migrations = await Promise.all(tags.map(async tag => {
    const source = await readFile(`drizzle/${tag}.sql`, 'utf8');
    return { tag, source, hash: createHash('sha256').update(source).digest('hex') };
  }));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const direct = new URL(process.env.DATABASE_URL);
  direct.hostname = direct.hostname.replace('-pooler.', '.');
  const pool = new Pool({ connectionString: direct.toString(), max: 1, connectionTimeoutMillis: 30_000 });
  try {
    const db = drizzle(pool);
    const results = await db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(724137, 2)`);
      await tx.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
      await tx.execute(sql`CREATE TABLE IF NOT EXISTS drizzle.tech_kpi_migration (
        id text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      const outcome: string[] = [];
      for (const { tag, source, hash } of migrations) {
        const previous = await tx.execute<{ hash: string }>(sql`SELECT hash FROM drizzle.tech_kpi_migration WHERE id = ${tag}`);
        if (previous.rows.length) {
          if (previous.rows[0].hash !== hash) throw new Error(`The applied migration ${tag} has changed.`);
          outcome.push(`${tag}: already applied`);
          continue;
        }
        for (const statement of source.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean)) {
          await tx.execute(sql.raw(statement));
        }
        await tx.execute(sql`INSERT INTO drizzle.tech_kpi_migration (id, hash) VALUES (${tag}, ${hash})`);
        outcome.push(`${tag}: applied`);
      }
      return outcome;
    });
    console.log(`App migrations\n  ${results.join('\n  ')}\nTransaction committed.`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  const cause = error as { code?: string; cause?: { code?: string } };
  console.error(`App migration failed (${cause.code ?? cause.cause?.code ?? 'setup or connection error'}). No partial transaction was committed.`);
  process.exitCode = 1;
});
