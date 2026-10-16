# Urban Gabru tech workspace

A practical dashboard for daily standups, tasks, bugs, and weekly delivery. Built with Next.js, TypeScript, Better Auth, Drizzle, and Neon Postgres.

## Open the app

```sh
npm install
npm run dev
```

Open [the workspace](http://localhost:3100). Port 3100 avoids another app already running on this machine. [Explore the demo](http://localhost:3100/demo/dashboard) to try a populated workspace. Demo changes stay in browser storage and never reach Neon.

The initial admin is `rutwik.shinde@urbangabru.in`. Sign-in uses company Microsoft accounts only. There are no local passwords.

Microsoft sign-in is configured on this machine. For a new environment, run the setup wizard to connect your Microsoft Entra app registration:

```sh
npm run setup:microsoft
```

It guides you through the client ID, tenant ID, Web redirect URI, hidden client-secret entry, and the admin’s Microsoft user Object ID. It writes only these keys to the main `.env.local`, preserves the database connection, and links the existing admin account. The redirect URI for this machine is `http://localhost:3100/api/auth/callback/microsoft`.

Use a registration restricted to your organisation. Each member is added from **Team** with their work email and Microsoft user Object ID. The ID comes from Entra ID → Users → the person → Overview. This is a one-time connection. An existing Microsoft account link cannot be changed through the app. Microsoft handles passwords, MFA, and other sign-in rules.

The admin's existing Microsoft work account was found through Microsoft Graph and linked to the dashboard. A real Microsoft sign-in, provider callback, admin access, and session restoration after reload passed on 14 October 2026.

## Interface and themes

The interface uses official shadcn/ui components with the Radix Nova style. Cards, tables, selects, checkboxes, dialogs, sheets, navigation, alerts, progress, charts, and form fields share the same theme. Component configuration is in `components.json`; generated components are in `src/components/ui`.

Use the appearance menu in the header to choose Light, Dark, or System. The preference stays after reload and is shared between login and the workspace. Geist is bundled locally, so the build does not need Google Fonts. Shared semantic color tokens live in `src/app/globals.css`.

## Daily workflow

1. The admin creates a project, selects its developers, and adds any phases, such as Build, Testing, and Release. Project members and phase names can be updated later. A developer with unfinished work must keep their project assignment until that work is completed or reassigned.
2. The admin adds a task with its title, owner, and agreed estimate. Project and phase start at **Ad hoc**. Select a project to choose one of its phases and assigned members. The estimate includes development, testing, and bug fixes.
3. Developers start their work, record blockers, and submit it for review. The admin approves completion or sends it back with a reason.
4. Log a bug from the same quick entry form. Linking a task fills its owner, project, and phase. Developers mark fixes ready; the admin verifies them.
5. Use the overview to find pending reviews, overdue work, and blockers. The team table shows each developer’s workload and score. Use Daily standup to review each person and add their next task.
6. Estimates and due dates require a reason when changed. Task and bug timelines keep the record. Attach screenshots, PDFs, text logs, CSV, or JSON files, up to 10 MB each.

There are two roles: **Admin** and **Developer**. Admins manage projects, phases, team assignments, and work. Developers see their assigned projects and their own work. Tasks have **To do**, **In progress**, **Blocked**, **In review**, and **Done** states. Bugs have **Open**, **In progress**, **Fixed**, and **Verified** states. The server checks sessions, roles, project membership, and record ownership on every request.

**Ad hoc** is the built-in project for unplanned work and is available to everyone. Within any project, the **Ad hoc** phase means the work has no named phase yet. The built-in project cannot be renamed or archived. Existing tasks keep their current project and begin with the Ad hoc phase; their owners become project members during migration.

For an existing installation, apply the versioned project and phase migration once:

```sh
npm run db:migrate:projects
```

The migration runner uses a direct connection, applies changes in one transaction, and records a checksum so a second run is safe. It preserves `.env.local`. `KPI_MIGRATION_ENV` can point at a separate environment file when testing a Neon branch. For a new empty database, use `npx drizzle-kit migrate` to apply the full migration history, including the built-in Ad hoc project and membership backfill.

## KPI rules

- Developer efficiency: delivery × 80% + bug resolution × 20%. Both weights are configurable.
- Delivery uses the estimates of tasks completed in the selected week. The score caps at 100%; the dashboard also shows the actual delivery ratio.
- Default developer capacity is 33 hours/week. The lead has 10 hours/week for their own tasks. Leave, holidays, and join dates reduce available capacity.
- Bug clocks count working hours, default Monday–Friday, 10:00–19:00 in Asia/Kolkata. Critical targets are 4 working hours; normal targets are 18. A fix within the target earns 100; within twice the target earns 50; later earns 0.
- Lead efficiency uses 70% team efficiency and 30% own delivery. The team average excludes developers with no capacity.
- The current week updates live. The weekly cron locks the previous week’s results. Locked scores retain their original capacity, weights, and membership. A bug already counted in a locked week cannot count again after reopening or reassignment.

## Database and services

The existing Neon project is `misty-band-92860743`, branch `production`, organisation `org-wild-bush-84986385`.

`.env.local` is stored in the main project directory, has owner-only file access, and is ignored by Git. No separate worktree was created. Keep this file when switching branches. `.env.example` lists the keys without credentials.

```sh
npm run db:migrate:projects
npm run neon:deploy
```

The deployment wrapper runs `neon deploy --env .env.local`, refreshes the service variables, and restores the original supplied database URL. It deploys a private `assets` bucket and a secret-protected `workload` function. Better Auth runs inside Next.js, uses Microsoft OAuth, and keeps its users and sessions in Neon. It recognises prelinked Microsoft user Object IDs in the configured tenant. Unlinked accounts cannot sign up, and email matching cannot grant an admin role. The existing managed `neon_auth` schema is preserved.

The app’s attachment endpoint checks record ownership, then stores the file in the private bucket. Downloads use short-lived signed URLs. The admin-only `/api/workload` endpoint calls the deployed function, which reads pending task and bug counts from Postgres. `/api/services` checks all provisioned connections.

**AI Gateway could not be provisioned:** Neon rejected it because the project is on the Free plan. `neon.ts` sets `aiGateway: false` so the other services can deploy. No paid plan was purchased.

The first-admin setup is a local CLI, with no public account-creation endpoint:

```sh
npm run setup:admin
```

It refuses to create another initial admin. Use Team for later accounts.

## Verify

Run a server before the integration and browser checks:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run verify:backend
npm run verify:services
npm run test:e2e
```

The integration scripts use temporary, Node-only database/session fixtures. They never add a public test login endpoint and remove their temporary records, sessions, and storage objects. These fixtures verify application permissions and workflows; they do not prove a real Microsoft sign-in. Playwright uses installed Google Chrome; browser assertions run against `http://localhost:3100` by default. Complete a real Microsoft login after configuring the app registration to verify the provider callback.

The weekly snapshot endpoint requires `Authorization: Bearer <CRON_SECRET>`. `vercel.json` schedules it on Sunday at 18:40 UTC, which is Monday 00:10 in India. The schedule takes effect when the frontend is deployed to Vercel. This project has been verified locally; Neon hosts the backend services.

For a hosted frontend, set the same server environment variables and set `BETTER_AUTH_URL` to its public origin. Do not expose the database, storage, or function secrets through `NEXT_PUBLIC_` variables.

Microsoft setup follows the [Better Auth Microsoft provider](https://better-auth.com/docs/authentication/microsoft) and [Microsoft app registration guide](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app).

## Verification recorded on 13 October 2026

The final production build runs locally on port 3100. These checks passed against that build:

```text
npm run build        ✓ Compiled successfully; static pages generated
npm run lint         exit 0
npm run typecheck    exit 0
npm test             43 passed
npm run test:e2e     11 passed (49.0 seconds)
npm run verify:backend
  PASS: 57 backend checks
  Temporary verification records removed.
npm run verify:services
  Postgres: task created via authenticated app API and returned from Neon.
  Object Storage: private upload and signed download matched; anonymous access denied.
  Functions: app → deployed workload function → Postgres returned task; anonymous access denied.
  Temporary service verification task and attachment removed.
```

Browser checks cover quick task and linked bug entry, persistence after reload, estimate revision with a reason, the task timeline, list/board filters, standup entry with Enter, mobile navigation and keyboard focus, saved settings, and India date labels in a browser set to Los Angeles.

The tests above use temporary Node-only signed-session fixtures. They verify the app’s permissions and data flows, **not a real Microsoft OAuth exchange**. Redirect URL construction and PKCE were checked with test registration IDs in an isolated process; those IDs were not saved in `.env.local`. The subsequent real Microsoft sign-in verification is recorded below.

The only service provisioning failure was AI Gateway: Neon rejected it on the Free plan. Postgres, private Object Storage, and the workload Function deployed successfully. `.env.local` remains in the main project directory with owner-only permissions and is ignored by Git.

## Microsoft sign-in verified on 14 October 2026

Both auth URLs in the main `.env.local` use `http://localhost:3100`. The supplied `AZURE_TENANT_ID` is also saved as `MICROSOFT_TENANT_ID`, which the app reads. All existing Neon service settings were preserved.

```text
Microsoft client credentials: token endpoint HTTP 200.
Microsoft Graph: existing admin work account lookup HTTP 200.
npm run auth:link-admin: existing admin Microsoft identity linked.
npm run build: compiled successfully; TypeScript and static generation passed.
npm run start: ready on localhost:3100.
Real browser sign-in: Microsoft → app callback → /dashboard.
Admin profile: Rutwik Shinde, Team lead · Admin, Microsoft Connected.
Reload: authenticated dashboard session retained.
Database check: one Microsoft link, no password account, one active session.
Anonymous requests: dashboard redirects to login; get-session returns null.
```

The Graph API refused a redirect-list update with HTTP 403, so the registration was not changed. Its existing `http://localhost:3000/api/auth/callback/microsoft` Web callback already permits the same localhost path on port 3100. Microsoft [ignores the port when matching localhost redirects](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url#localhost-exceptions) and advises against duplicate entries that differ only by port. The real browser callback passed with this registration. Hosted domains require their own matching callback URI.

## Shadcn interface verified on 14 October 2026

The final interface uses official shadcn/ui components for navigation, forms, dialogs, tables, cards, feedback, and charts. It includes Light, Dark, and System themes, locally bundled Geist, mobile navigation, and accessible keyboard controls. The quick-entry forms preserve optional context when it is collapsed.

```text
npm run build       Compiled successfully; TypeScript and static generation passed.
npm run lint        exit 0
npm run typecheck   exit 0
npx playwright test e2e/workspace.spec.ts
  12 passed (1.0m)
  Live Create task: HTTP 200, 3948 ms
  Live Revise estimate: HTTP 200, 4340 ms
  Live Log linked bug: HTTP 200, 4179 ms
  Temporary item and identity cleanup completed.
```

Browser checks cover theme persistence across login and workspace pages, system appearance, task and bug entry, collapsed context preservation, keyboard selects and dialog focus, standup entry, list and board controls, settings, mobile navigation at 375 pixels, and India date labels in a Los Angeles browser. Visual checks cover light and dark dashboards, login, and mobile settings. The existing Microsoft admin session remains valid after the redesign.

Earlier live checks encountered intermittent Neon connection setup timeouts. The connection setup limit is now 30 seconds. An isolated authenticated task save also returned HTTP 200, with its task and audit record independently confirmed in Postgres. The final full browser suite passed against the production build running on port 3100. No write retries were added.

## Projects and phases verified on 15 October 2026

Admins can create projects, select members, add phases, and edit membership and phase names later. Developers have read-only access to their assigned projects and their own historical work. Task and bug entry starts in the shared Ad hoc project with the Ad hoc phase. Selecting a project limits owners and phases to that project. A linked bug inherits its task's project and phase. Project and phase filters help admins find pending work.

Migration `0002_project_members_and_phases` was tested on a temporary Neon branch before being applied to production. A legacy task retained its owner, project, estimate, and status; the owner became a project member. Database checks rejected a cross-project phase and an attempt to archive the built-in Ad hoc project. Running the migration again safely reported `already applied`. The production database retained its existing project and gained the built-in Ad hoc project. The main `.env.local` was preserved with owner-only permissions.

```text
npm run build       Compiled successfully; TypeScript and static generation passed.
npm run lint        exit 0
npm run typecheck   exit 0
npm test            44 passed
Branch API verification
  PASS: 91 backend checks
  Temporary verification records removed.
npm run test:e2e    14 passed (1.1m), production build on port 3100
  Live Create task: HTTP 200, 5622 ms
  Live Revise estimate: HTTP 200, 3679 ms
  Live Log bug: HTTP 200, 4077 ms
  Temporary item and identity cleanup completed.
```

The browser suite includes mobile project creation, member selection, phase creation and renaming after reload, project-scoped owner and phase options, Ad hoc defaults, linked bug inheritance, task phase visibility, standup entry with Enter, keyboard focus, themes, and India date labels. Backend checks cover developer read-only access, assigned projects with no tasks, membership rules, inactive member preservation, reserved Ad hoc protections, and invalid phase associations. These checks use temporary local authentication fixtures; the real Microsoft OAuth verification remains recorded above.

An independent production query confirmed zero temporary browser-test users and work items after cleanup. The temporary Neon test branch and its private local connection file were removed. The production build remains running on port 3100.
