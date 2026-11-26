/**
 * Creates or removes a temporary signed-in test person for the browser tests, and prints the result as JSON.
 * The browser tests run it with tsx, which loads the app's `@/` imports; Playwright's own loader cannot.
 * Local test servers only: the fixture refuses any other address. It never tests a real Microsoft sign-in.
 */
import { config } from 'dotenv';
import type { Role } from '../src/lib/types';

config({ path: '.env.local', quiet: true });

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const { pool } = await import('../src/db');
  const fixtures = await import('../src/server/verification-fixtures');
  try {
    if (command === 'create') {
      const [role, name, baseURL] = args;
      const fixture = await fixtures.createOfflineSessionFixture({ baseURL, role: role as Role, name });
      process.stdout.write(`${JSON.stringify({ userId: fixture.userId, member: fixture.member, cookie: fixture.cookie, cookieHeader: fixture.cookieHeader })}\n`);
    } else if (command === 'dispose') {
      const [id, email] = args;
      await fixtures.disposeOfflineFixture(id, email);
      process.stdout.write('{"disposed":true}\n');
    } else throw new Error('Use: create <role> <name> <baseURL>, or dispose <id> <email>.');
  } finally {
    await pool.end();
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
