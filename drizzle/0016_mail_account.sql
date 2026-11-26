-- The mailbox the workspace sends email from, connected by signing in as it (delegated Mail.Send).
-- No organisation-wide permission is needed. The sign-in is stored encrypted and renewed as it is used.
CREATE TABLE "tech_kpi_mail_account" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "email" text NOT NULL,
  "refresh_token" text NOT NULL,
  "connected_by_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "connected_at" timestamptz DEFAULT now() NOT NULL,
  "last_used_at" timestamptz,
  "last_error" text,
  CONSTRAINT "tech_kpi_mail_account_singleton" CHECK ("id" = 1)
);
