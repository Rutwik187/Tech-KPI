import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encrypts a short secret, such as the mailbox sign-in, before it goes in the database. AES-256-GCM, with a key made
 * from MAIL_TOKEN_KEY, or from BETTER_AUTH_SECRET when that is not set. The server and the computer that runs
 * `npm run mail:connect` must have the same key. If the key changes, stored values can no longer be read, and the
 * mailbox must be connected again.
 */
function key(secret = process.env.MAIL_TOKEN_KEY || process.env.BETTER_AUTH_SECRET) {
  if (!secret) throw new Error("MAIL_TOKEN_KEY is not set.");
  return createHash("sha256").update(`tech-kpi:secret-box:${secret}`).digest();
}

export function seal(plain: string, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function open(sealed: string, secret?: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("The stored secret is not in a known format.");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
