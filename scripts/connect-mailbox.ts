/**
 * Connects the mailbox the workspace sends email from, without organisation-wide admin consent.
 *
 *   npm run mail:connect
 *
 * It opens a Microsoft sign-in in the browser. Sign in as the sending mailbox, such as tech@urbangabru.in, and accept.
 * That grants the delegated permission Mail.Send for that one mailbox. The script stores the sign-in, encrypted with
 * MAIL_TOKEN_KEY (which must match the server's), in the
 * database in DATABASE_URL, then sends a test email to the mailbox. Run it again whenever Settings says the sign-in expired.
 *
 *   npm run mail:connect -- --token-file <path>   stores a sign-in saved earlier as JSON { "refreshToken": "..." }
 *
 * It reads .env.local. A DATABASE_URL in the shell wins, so you can point it at a test database.
 */
import { config } from 'dotenv';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';

config({ path: '.env.local', quiet: true });

const PORT = 3999;
// Microsoft allows any port on a localhost address that is registered, so this reuses the app's local sign-in address.
const REDIRECT = `http://localhost:${PORT}/api/auth/callback/microsoft`;
const LOGIN = `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0`;

function need(name: string) {
  if (!process.env[name]) { console.error(`${name} is not set. Add it to .env.local.`); process.exit(1); }
}

async function token(params: Record<string, string>, scope: string) {
  const response = await fetch(`${LOGIN}/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID!, client_secret: process.env.MICROSOFT_CLIENT_SECRET!, scope, ...params }) });
  const body = await response.json() as { access_token?: string; refresh_token?: string; error_description?: string };
  if (!body.access_token || !body.refresh_token) throw new Error(`Microsoft did not sign in: ${body.error_description?.split('\r\n')[0] ?? response.status}`);
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

async function mailboxOf(accessToken: string) {
  const me = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers: { Authorization: `Bearer ${accessToken}` } }).then(r => r.json()) as { mail?: string; userPrincipalName?: string };
  const email = me.mail || me.userPrincipalName;
  if (!email) throw new Error('Microsoft did not say which mailbox signed in.');
  return email;
}

function signIn(scope: string): Promise<string> {
  const state = randomUUID();
  const url = `${LOGIN}/authorize?${new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID!, response_type: 'code', redirect_uri: REDIRECT, scope, state, prompt: 'select_account' })}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { server.close(); reject(new Error('Nobody signed in within 10 minutes.')); }, 10 * 60_000);
    const server = createServer((req, res) => {
      const query = new URL(req.url!, `http://localhost:${PORT}`).searchParams;
      if (!query.has('code') && !query.has('error')) { res.end(); return; }
      const done = (message: string) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<p style="font:16px system-ui;padding:40px">${message} You can close this tab.</p>`); clearTimeout(timer); server.close(); };
      if (query.get('error')) { done('Microsoft did not sign in.'); reject(new Error(`Microsoft said: ${query.get('error_description')?.split('\r\n')[0] ?? query.get('error')}`)); return; }
      if (query.get('state') !== state) { done('The sign-in did not match.'); reject(new Error('The sign-in did not match. Run the command again.')); return; }
      done('Signed in. Go back to the terminal.');
      resolve(query.get('code')!);
    });
    server.listen(PORT, '127.0.0.1', () => {
      console.log('\nSign in as the mailbox that sends the emails, such as tech@urbangabru.in. If the browser does not open, open this address:\n');
      console.log(url, '\n');
      execFile(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [url], () => {});
    });
  });
}

async function main() {
  ['DATABASE_URL', 'MAIL_TOKEN_KEY', 'MICROSOFT_TENANT_ID', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'].forEach(need);
  const { MAILBOX_SCOPE, saveMailbox, sendMail } = await import('../src/server/mailer');
  const { pool } = await import('../src/db');
  const host = new URL(process.env.DATABASE_URL!).hostname;
  try {
    const fileAt = process.argv.indexOf('--token-file');
    const signed = fileAt > 0
      ? await token({ grant_type: 'refresh_token', refresh_token: (JSON.parse(readFileSync(process.argv[fileAt + 1], 'utf8')) as { refreshToken: string }).refreshToken }, MAILBOX_SCOPE)
      : await token({ grant_type: 'authorization_code', code: await signIn(MAILBOX_SCOPE), redirect_uri: REDIRECT }, MAILBOX_SCOPE);
    const email = await mailboxOf(signed.accessToken);
    await saveMailbox({ email, refreshToken: signed.refreshToken });
    console.log(`Connected ${email}. Stored in the database at ${host}.`);
    await sendMail({ to: email, subject: 'The tech workspace now sends email from this mailbox', html: '<p style="font-family:Segoe UI,Arial,sans-serif;font-size:14px">This mailbox is connected. The Urban Gabru tech workspace sends request emails from it.</p>' });
    console.log(`A test email was sent to ${email}.`);
  } finally { await pool.end(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
