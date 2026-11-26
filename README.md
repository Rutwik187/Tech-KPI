# Urban Gabru tech workspace

One place for the whole company to ask the tech team for new tools, changes to the tools they use, and fixes, and to follow each request until it is done. The tech team also runs its daily standups, tickets, bugs, and weekly delivery here. Built with Next.js, TypeScript, Better Auth, Drizzle, and Neon Postgres.

## Open the app

```sh
npm install
npm run dev
```

Open [the workspace](http://localhost:3100). Port 3100 avoids another app already running on this machine. [Explore the demo](http://localhost:3100/demo/dashboard) to try a populated workspace. Demo changes stay in browser storage and never reach Neon.

The initial admin is `rutwik.shinde@urbangabru.in`. Sign-in uses company Microsoft accounts only. There are no local passwords. An admin gives everyone their role on **People**, and adds people from teams outside tech, such as Sales or Creative, on **Other teams**. A tech lead adds developers and project managers on **Team**. Everyone signs in the same way. See [Roles and access](#roles-and-access) and [Requests from other teams](#requests-from-other-teams).

## Roles and access

The workspace serves the whole organisation. Each person sees only the pages and records their role allows. The server checks the same rules on every read and every change, so a hidden button is never the only protection. The rules are in one file, `src/lib/permissions.ts`, which the server, the pages, and the demo all use.

| Role | Sees | Can do |
| --- | --- | --- |
| **Admin** | Everything: every request, ticket, bug, project, score, person, team outside tech, and the activity log | Everything a tech lead can, plus: give any role, manage teams outside tech and their people, choose who can sign in, and read the **Activity** log |
| **Tech lead** | Every request, ticket, bug, project, and score, and the people on the tech side. Not the people in teams outside tech | Assign, decline, and send back requests. Create and approve tickets and bugs. Run projects, standup, approvals, and leave. Change KPI settings and holidays. Add and change developers and project managers |
| **Project manager** | Every request, with its comments, files, and who works on it. No tickets, people, or scores | Correct new requests, comment, forward them to the tech lead, or decline them |
| **Developer** | Their own tickets, bugs, leave, and projects, and the requests behind their own work | Work on their tickets and bugs, request tickets, hours, and leave, and comment on their requests |
| **Other team** | Their own requests and their team's | Raise, change, and withdraw requests while a project manager has them, comment, and add files |

Safeguards:

- Nobody can change their own role or turn off their own access. The organisation always keeps one active admin.
- A tech lead can change only developers and project managers, and can make someone only a developer or a project manager.
- A tech lead changes working hours and scores in **Settings**, but only an admin changes who can sign in.
- Someone with open tickets or project memberships must hand them over before becoming a project manager or joining a team outside tech.

The menu has three groups: **Workspace** (Overview and Requests), **Tech team**, and **Organisation** (People, Other teams, and Activity). Each person sees only the groups and pages they can use. An admin's and a tech lead's overview starts with **Requests across the organisation**: where every request is, how long requests wait to be assigned, and which teams ask most. The demo's **View as** menu lets you try every role.

The database stores each role by name (`admin`, `tech_lead`, `project_manager`, `requester`). Better Auth stores a developer as `user`. No migration is needed for the roles: accounts that were `admin` stay admins and keep all their access. Make someone tech lead on **People**.

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

### Finding and moving work

- **Search.** Press ⌘K (Ctrl K on Windows), or select the search box in the header. Type a key such as `UG-014`, only its number (`14`), or words from a title. Search also finds projects, people (for the tech lead), pages, and actions such as New ticket.
- **Shortcuts.** Press C to add a ticket (or request one, for a developer). On Tickets and Bugs, press / to search the list. Shortcuts do nothing while you type in a field or while a form is open.
- **Links to a ticket.** An open ticket or bug is part of the address, for example `/tickets?open=UG-014`. Copy it with the link button at the top of the details panel, or from the ⋯ menu on any row. Anyone with access opens the same details.
- **Ticket and bug lists.** Rows are grouped by status, with a count and total hours per group. Group by owner or project, or turn groups off. The status tabs show how many items each status has with the current filters. Each row has its next step and a ⋯ menu with the other steps: mark blocked, unblock, extend the date, add hours, send back, and reopen. The list or board choice, the grouping, and the sort stay after a reload, in this browser only.
- **Overview.** A developer's overview starts with **My work**: what needs attention, what is for today, what is next, and what waits for review. The tech lead's overview starts with the team's numbers and the work that waits for a decision. The counts on the Open tickets card open the matching list.
- **Unblock.** A blocked ticket's owner or the tech lead chooses **Unblock** when the blocker is cleared. The ticket goes back to In progress and the timeline records it.

Status icons have one shape per state: a dashed circle for To do, a half circle for In progress, a bar for Blocked, a three-quarter circle for In review or Fixed (waiting for the tech lead), and a check for Done or Verified.

## Daily workflow

1. The tech lead creates a project with a title, an optional description, its members, and any phases, such as Build, Testing, and Release. Each phase has a title and an optional description. Members and phases can be changed later. A member with unfinished work stays on the project until that work is finished or reassigned.
2. The tech lead or a developer adds a **ticket** with a title, project, phase, estimate, and optional due date. Developers add tickets only for themselves, in Ad hoc or a project they belong to. The estimate covers building, testing, and fixes. It is the number of hours the ticket earns when the tech lead approves it.
3. The owner starts the ticket, marks blockers, and submits it for review. The tech lead approves it or sends it back with a reason.
4. If a ticket needs more time, its owner or the tech lead extends the due date with a reason. The ticket shows an **Extended** badge and the timeline keeps every extension and reason. Only the tech lead changes an estimate, owner, or project, because these change the score.
5. The tech lead logs **bugs**, optionally linked to a ticket. Each bug gets a fix-by time from its severity. Developers mark fixes; the tech lead verifies them.
6. Developers can **request leave** from Overview or Approvals, for a full day, half day, or a range of up to 62 calendar days. Requests wait in Approvals and the tech lead notification menu. Developers see their own requests and can withdraw pending ones. The tech lead approves them or declines with a reason. Only approval records leave and changes hours at work. Duplicate recorded or pending dates are skipped.
7. The tech lead can also record **leave** on the Team page: a full day, a half day, or a range of days. Leave appears per person, on their member panel, and in one list. Weekends and holidays inside a range are skipped.
7. Use the overview and the bell menu to find reviews, blocked tickets, late work, and late bugs. Use Daily standup to go through each person and add tickets as you talk.

There are five roles: **Admin**, **Tech lead**, **Project manager**, **Developer**, and **Other team** (see [Roles and access](#roles-and-access)). The tech lead manages projects, phases, the tech team, leave, and all work, and assigns requests from other teams. An admin can do all of that and also manages the organisation. Project managers review requests from other teams and forward them to the tech lead. They see requests only, never tickets, people, or scores. Developers see their assigned projects and their own tickets and bugs, add tickets for themselves, and edit the title, details, priority, and due date of their own tickets. Tickets have **To do**, **In progress**, **Blocked**, **In review**, and **Done** states. Bugs have **Open**, **In progress**, **Fixed**, and **Verified** states. People from other teams, such as Sales, raise requests for their team and follow them, and see nothing else. The tech lead can mark any of them as their team's **team lead**. The server checks sessions, roles, project membership, and record ownership on every request.

The database still calls a ticket a `task` (for example `type = 'task'`). Only the words people read changed. Old `/tasks` links redirect to `/tickets`.

**Ad hoc** is the built-in project for unplanned work and is available to everyone. Within any project, the **Ad hoc** phase means the work has no named phase yet. The built-in project cannot be renamed or archived.

For an existing installation, apply the versioned app migrations:

```sh
npm run db:migrate
```

This applies `0002_project_members_and_phases` and `0003_phase_description` (it adds the phase description column). Run it before deploying this version: the app reads phase descriptions on every page. `0010_tech_requests` adds requests from other teams: the teams table, seeded with Sales, E-commerce, Influencer marketing, Digital marketing, Creative, and Graphics, each person's team, and the requests table. `0012_leave_requests` adds developer leave requests and tech lead decisions; apply it before deploying this version. `0014_request_flow` adds the project manager step (`forwarded` status and who forwarded it), the optional tool name, the **New tool** kind, request comments, and files on requests. Requests that are new when it runs wait for a project manager; the tech lead can still assign them. `0011_team_leads` records who leads each team. Everyone added to a team before it ran was added as a team lead, so they stay team leads. Every page reads these tables and columns, so apply each migration before you deploy the version that needs it. `npm run db:migrate:projects` is the same command under its old name. The migration runner uses a direct connection, applies changes in one transaction, and records a checksum per migration so a second run is safe. It preserves `.env.local`. `KPI_MIGRATION_ENV` can point at a separate environment file when testing a Neon branch. For a new empty database, use `npx drizzle-kit migrate` to apply the full migration history, including the built-in Ad hoc project and membership backfill.

## Requests from other teams

Sales, E-commerce, Influencer marketing, Digital marketing, Creative, Graphics, and any other team can ask the tech team for work here: a new tool, a change to a tool, a fix, a report, or access. A team can have as many **members** as it needs, and every member can raise requests. The tech lead marks who leads each team.

Each request passes three people:

```text
Requester raises it ──▶ With project manager ──▶ With tech lead ──▶ Assigned ──▶ In progress ──▶ Done
                         forward, edit,            assign to a
                         comment, or decline       developer, edit,
                                                   comment, decline,
                                                   or send back
```

The tech lead can also act on a request that is still with a project manager. So a request never waits when no project manager is added yet, or when one is away.

- **Comments.** Everyone who can see a request can comment on it: the requester and their team, project managers, the tech lead, and the developer who has its ticket. The tech side can mark a comment **Tech team only**. A requester never receives those comments. A note written when forwarding or sending back is always tech team only. People remove their own comments. The tech lead can remove any comment.
- **Files.** Requests, tickets, and bugs take files: images, PDFs, short videos, Word, Excel, PowerPoint, CSV, and text files, up to 10 MB each. Drop files on the panel, paste a screenshot, or choose several at once. A requester can attach files while raising a request. Images show a preview, and images, PDFs, and videos open in a new tab. The person who added a file can remove it, and so can the tech lead. Downloads use links that expire after five minutes.
- **History.** Each request lists its steps: raised, changed, forwarded, sent back, assigned, declined, and files added or removed. A requester does not see when the tech lead sends a request back, or the notes the tech side wrote for itself.
- **Details panel.** Select a request to open its details, files, comments, and history. Its key is part of the address, for example `/requests?request=REQ-014`, so the link can be shared. A developer opens the request from its ticket.

1. **Create teams and add their members.** On **Other teams**, an admin creates each team and adds its members, with a name and a work email. Tick **Team lead** for the people who lead the team. The first person added to a team starts ticked; untick it if they do not lead it. A team can have more than one team lead. Being a team lead changes how a person is shown, not what they can do. Each member signs in with the Microsoft work account for that email. Only the people the tech lead adds can sign in. To also let in everyone with a company email, the tech lead adds the domain, such as `urbangabru.in`, under **Who can sign in** on the same page. People who get in that way join as members, and their first request sets their team. Guest accounts, and people whose access the tech lead turned off, never get in that way.
2. **Raise a request.** A member says what they need, picks the kind of request (new tool, new feature, change to a tool, something broken, data or report, access or setup, or something else), which tool it is about (optional), the team, how urgent it is, an optional date, and optional files. They can change or withdraw a request until a project manager forwards it. After that, they add a comment instead.
3. **Review and forward.** New requests land on **Requests**, the project managers' inbox. The most urgent come first, then the soonest needed, then the oldest. A project manager asks questions in the comments, corrects the details, and **forwards** the request to the tech lead, with an optional urgency change and a note for the tech lead. Or they **decline** it with a reason.
4. **Assign or decline.** Forwarded requests wait in the tech lead's **To assign** tab. **Assign** makes a ticket, with an estimate and a date, or a bug, with a fix-by time, for a developer. A request about something broken starts as a bug. **Decline** needs a reason, and the person who asked reads it. **Send back** returns it to the project managers with a reason only the tech side sees.
5. **Follow it.** The person who asked sees each request move from **With project manager** to **With tech lead**, **Assigned**, **In progress**, and **Done**, with who works on it and the planned date. A blocked ticket shows as in progress. Everyone in a team sees the team's requests, under the team's name on **My requests**, so nobody asks twice.

The ticket or bug made from a request shows who asked and for which team. Its hours count like any other ticket. To give the work to another developer, change the ticket's owner. On **Other teams**, the tech lead also rename and archive teams. An archived team keeps its old requests and takes no new ones.

A member's workspace has two pages: **My requests** and **My account**. They never see tickets, bugs, projects, people, or scores. On every request, the server allows a member to raise, change, and withdraw their own requests while a project manager has them, to comment on their team's requests, and to add files to them. A team lead cannot change a teammate's request either.

A project manager's workspace has **Requests** and **My account**. They see every team's requests, with comments, files, and who works on each one. They cannot assign work, change people, or see tickets or scores. An admin or the tech lead adds project managers, with the role **Project manager**. A developer with open work or project memberships must hand those over before becoming a project manager.

Each member needs a Microsoft account in your organisation, as a member or an invited guest. Add members using their work email. Their Microsoft account is linked when they first sign in with that email. Also check this app's enterprise application in Microsoft Entra ID. When **Assignment required** is on, Microsoft lets in only assigned people. Assign the members, or their groups, to the app, or turn it off.

The database calls a team outside tech a `department` (table `tech_kpi_department`), a person in one a `requester` (user role `requester`), and a request a `tech request` (table `tech_kpi_tech_request`). The **Team lead** mark is `is_team_lead` on `tech_kpi_member_profile`. Each role is stored by name: `admin`, `tech_lead`, `project_manager`, `requester`, and `user` for a developer. A request with a project manager has status `new`; one with the tech lead has status `forwarded`. Comments are in `tech_kpi_request_comment`. People read "tech lead", "project manager", "team", "member", "team lead", and "request". A **team lead** leads a team outside tech; the **tech lead** leads the tech team.

## KPI rules

- **Efficiency** = ticket hours × 80% + bug points × 20%. Both weights are configurable in Settings.
- **Ticket hours** = estimates of tickets the tech lead approved this week ÷ hours at work. This part caps at 100%; the dashboard also shows the uncapped ratio.
- **Hours at work** = weekly hours (default 33 for developers, 10 for the tech lead’s own tickets) minus leave, holidays, and days before a person joined. During the current week, only days up to and including today count, so scores are fair mid-week. Time off lowers hours at work, never the score.
- **Bug points**: each bug has a fix-by time, counted in working hours (default Monday–Friday, 10:00–19:00, Asia/Kolkata). Critical bugs get 4 working hours; normal bugs get 18. Fixed on time earns 100, within twice the target earns 50, later earns 0. Bug points are the average for bugs scored that week. A week with no scored bugs keeps the full 100. Bugs add no ticket hours.
- **Admin score** = 70% team efficiency + 30% their own ticket hours. The team average excludes developers with no hours at work.
- The weekly cron locks the previous week’s results. Locked scores keep their original hours, weights, and membership. A bug already counted in a locked week cannot count again after reopening or reassignment.

## Database and services

The existing Neon project is `misty-band-92860743`, branch `production`, organisation `org-wild-bush-84986385`.

`.env.local` is stored in the main project directory, has owner-only file access, and is ignored by Git. No separate worktree was created. Keep this file when switching branches. `.env.example` lists the keys without credentials.

```sh
npm run db:migrate
npm run neon:deploy
```

The deployment wrapper runs `neon deploy --env .env.local`, refreshes the service variables, and restores the original supplied database URL. It deploys a private `assets` bucket and a secret-protected `workload` function. Better Auth runs inside Next.js, uses Microsoft OAuth, and keeps its users and sessions in Neon. It recognises prelinked Microsoft user Object IDs in the configured tenant. Unlinked accounts cannot sign up, and email matching cannot grant an admin role. The existing managed `neon_auth` schema is preserved.

The app’s attachment endpoint checks record ownership, then stores the file in the private bucket. Downloads use short-lived signed URLs. The tech lead-only `/api/workload` endpoint calls the deployed function, which reads pending task and bug counts from Postgres. `/api/services` checks all provisioned connections.

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

## Tickets, leave, and scoring update — 16 October 2026

This version renames tasks to tickets in the interface, lets developers add their own tickets and extend due dates with a reason, adds phase descriptions, adds leave ranges to team management, and makes current-week scores use hours at work so far. The interface code moved from one file into `src/components/workspace/`.

```text
npm run typecheck   exit 0
npm run lint        exit 0
npm test            47 passed
npm run build       compiled successfully
npx playwright test --grep-invert "local fixture" (dev server on port 3200)
  14 passed: every demo flow, including a developer adding and extending a ticket,
  and an admin adding and removing a three-day leave range.
```

Not yet verified in this version: `npm run verify:backend`, `npm run verify:services`, and the live Playwright tests. They need the Neon database, and migration `0003_phase_description` has not been applied to any database yet. The backend checks were updated for the new rules (developer tickets, due date extensions, leave ranges, phase descriptions).

Use **View as** in the demo banner to see the workspace as any developer.

## Requests from other teams — 4 November 2026

This version adds **team leads** for teams outside tech, the **Other teams** page where an admin creates teams and adds team leads, the **Requests** inbox, and migration `0010_tech_requests`. Sign-in is closed by default: only the team leads an admin adds can sign in. The checks below ran against a temporary local PostgreSQL 17 database, never against Neon. Migrations `0000`–`0009` were applied to it first, so it matched production before the upgrade.

```text
npm run typecheck   exit 0
npm run lint        exit 0
npm test            63 passed
npm run build       compiled successfully
npm run db:migrate  0010_tech_requests: applied (0002–0009 already applied); a second run: already applied
npm run verify:backend (production build)
  PASS: 345 backend checks
  Temporary verification records removed.
npx playwright test --grep-invert "local fixture" (production build)
  38 passed
```

The new backend checks cover what a team lead can see and do, team visibility, assigning a request as a ticket or a bug, declining with a reason, withdrawing, team management, and the database rules. Company sign-in was checked with no domain allowed, which is the default, then with an allowed domain, another tenant, a guest account, and a second account with the same email. The new browser checks cover creating a team, adding its team lead, raising, changing, assigning, following, declining, and withdrawing a request, and archiving a team.

An earlier run of the whole browser suite, with the local fixture tests, had 39 passed and 1 failed. The failure, "live ticket and linked bug entry pass through the API to Neon and render after reload", is not caused by this change. It expects a ticket without a date. Every new ticket has had a date since "give every ticket a date instead of a due date", so the test's expectation is out of date.

Migration `0010_tech_requests` was applied to the production database on 4 November 2026. Not verified in this version: a real Microsoft sign-in by a team lead.

## Several members per team — 4 November 2026

A team outside tech can now have several members, and all of them can raise requests. An admin marks who leads each team with **Team lead**. The mark changes how a person is shown, not what they can do. Migration `0011_team_leads` adds it. Everyone already in a team was added as a team lead, so the migration keeps them team leads. The checks below ran against a temporary local PostgreSQL 17 database, never against Neon. It was first brought to production's state with `0000`–`0010`.

```text
npm run typecheck   exit 0
npm run lint        exit 0
npm test            65 passed
npm run build       compiled successfully
npm run db:migrate  0011_team_leads: applied (0002–0010 already applied); a second run: already applied
  before: a person in Sales, a person without a team, and a developer
  after:  the person in Sales is a team lead; the other two are not
npm run verify:backend (production build)
  PASS: 362 backend checks
  Temporary verification records removed.
npx playwright test (production build on port 3200, with the sign-in address on port 3200)
  39 passed, 1 failed
```

The new backend checks cover adding a member with and without the mark, two team leads in one team, a member's own view, and moving a person to the tech team, which clears their team and the mark. A developer cannot be marked as a team lead, and a member cannot change the mark. The new browser check adds two people to a new team, the first as its team lead. The other member raises a request, and the team lead sees it. The one failure is the out-of-date test described above.

Apply `0011_team_leads` to production with `npm run db:migrate` before you use this version.
