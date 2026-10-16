import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local", quiet: true });
const migrationUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (migrationUrl) migrationUrl.hostname = migrationUrl.hostname.replace("-pooler.", ".");
export default defineConfig({
  schema: "./src/db/schema/*.ts", out: "./drizzle", dialect: "postgresql",
  dbCredentials: { url: migrationUrl?.toString() ?? "" },
});
