import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';
// Keep the user-supplied connection in the main checkout when Neon refreshes env.
const envPath = new URL('../.env.local', import.meta.url);
const original = parse(readFileSync(envPath, 'utf8')).DATABASE_URL;
const result = spawnSync('neon', ['deploy', '--env', '.env.local'], {stdio:'inherit', cwd:new URL('..',import.meta.url)});
let content = readFileSync(envPath, 'utf8');
if (original) content = content.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${original}`);
writeFileSync(envPath, content);
chmodSync(envPath, 0o600);
process.exit(result.status ?? 1);
