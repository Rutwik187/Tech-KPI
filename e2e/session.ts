import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
/** A temporary signed-in person for a browser test. `dispose` removes them and their history. */
export type SessionFixture = {
  userId: string;
  member: { id: string; name: string; email: string; role: string; isActive: boolean };
  cookie: { name: string; value: string; url: string; httpOnly: boolean; secure: boolean; sameSite: 'Lax' };
  cookieHeader: string;
  dispose(): Promise<void>;
};

async function tsx(args: string[]) {
  const { stdout } = await run('npx', ['tsx', 'scripts/e2e-session.ts', ...args], { env: process.env, maxBuffer: 1024 * 1024, timeout: 60_000 });
  return JSON.parse(stdout.trim().split('\n').at(-1)!);
}

/** Creates the person in a separate tsx process, which loads the app's `@/` imports. It uses the exported DATABASE_URL. */
export async function createSession(role: string, name: string): Promise<SessionFixture> {
  const created = await tsx(['create', role, name, process.env.TEST_BASE_URL ?? 'http://localhost:3100']);
  return { ...created, dispose: async () => { await tsx(['dispose', created.userId, created.member.email]); } };
}
