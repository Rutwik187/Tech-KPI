import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDemoData } from '../src/lib/demo';
import { dateKey, dueDateAfterHours, getWeekStart, getWorkCalendar, shiftDate } from '../src/lib/kpi';
import { daysBetween } from '../src/lib/timeline';
import { ADHOC_PROJECT } from '../src/lib/project-defaults';
import type { DashboardData } from '../src/lib/types';

// Session fixture cookies must never enter trace artifacts. This suite does not exercise Microsoft OAuth.
/** The overview greets the signed-in person by the time of day. */
const OVERVIEW = /^Good (morning|afternoon|evening), /;
test.use({ timezoneId: 'Asia/Kolkata', trace: 'off', screenshot: 'off', video: 'off' });

async function openDemo(page: Page, section = 'dashboard') {
  await page.goto(`/demo/${section}`);
  await expect(page.locator('.demo-banner')).toBeVisible();
  await expect(page.getByText('Demo workspace', { exact: true })).toBeAttached();
}

async function chooseOption(page: Page, trigger: Locator, label: string) {
  await trigger.click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await expect(trigger).toHaveText(label);
}

/** Clicks a calendar day (`YYYY-MM-DD`) in the open shadcn calendar, moving month by month. */
async function clickDay(page: Page, iso: string) {
  const calendar = page.locator('[data-slot="popover-content"][data-state="open"] [data-slot="calendar"]');
  for (let step = 0; step < 24; step++) {
    const cell = calendar.locator(`td[data-day="${iso}"]:not([data-outside])`);
    if (await cell.count()) { await cell.getByRole('button').click(); return; }
    const shown = await calendar.locator('td[data-day]:not([data-outside])').first().getAttribute('data-day');
    await calendar.getByRole('button', { name: (shown ?? '') < iso ? /next month/i : /previous month/i }).click();
  }
}

/** Picks a calendar day (`YYYY-MM-DD`) in a shadcn date picker. */
async function pickDate(page: Page, trigger: Locator, iso: string) {
  await trigger.click();
  await clickDay(page, iso);
  await expect(trigger).toHaveAttribute('data-value', iso);
  await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0);
}

/** Picks the first and last day in a shadcn date range picker. The same day twice picks one day. */
async function pickDateRange(page: Page, trigger: Locator, start: string, end: string) {
  await trigger.click();
  await clickDay(page, start);
  await clickDay(page, end);
  await expect(trigger).toHaveAttribute('data-start', start);
  await expect(trigger).toHaveAttribute('data-end', end);
  await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0);
}

async function readDemoData(page: Page): Promise<DashboardData> {
  return page.evaluate(() => {
    const saved = localStorage.getItem('urban-gabru-kpi-demo-v7');
    if (!saved) throw new Error('Demo changes did not persist.');
    return JSON.parse(saved) as DashboardData;
  });
}

async function saveLiveForm(page: Page, dialog: Locator, label: string | RegExp) {
  const started = Date.now();
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/data') && response.request().method() === 'POST', { timeout: 45_000 }),
    dialog.getByRole('button', typeof label === 'string' ? { name: label, exact: true } : { name: label }).click(),
  ]);
  console.log(`[live verification] ${label}: API ${response.status()} in ${Date.now() - started} ms`);
  if (!response.ok()) {
    const body = await response.json() as { error?: string };
    console.log(`[live verification] Public API error: ${typeof body.error === 'string' ? body.error : 'No error message'}`);
  }
  expect(response.status()).toBe(200);
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}

type OfflineFixture = {
  userId: string;
  member: { id: string; name: string; role: string; isActive: boolean };
  cookie: { name: string; value: string; url: string; httpOnly: boolean; secure: boolean; sameSite: 'Lax' };
  dispose(): Promise<void>;
};

/** Local verification only. It proves session authorization, not Microsoft OAuth login. */
async function authenticateWithFixture(page: Page): Promise<OfflineFixture> {
  const started = Date.now();
  const { config } = await import('dotenv');
  config({ path: resolve('.env.local'), quiet: true });
  const { createOfflineSessionFixture } = await import('../src/server/verification-fixtures');
  // A unique name keeps a leftover from an interrupted run from matching the same owner option.
  const fixture = await createOfflineSessionFixture({ baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3100', role: 'admin', name: `Browser verification administrator ${randomUUID().slice(0, 6)}` });
  console.log(`[fixture verification] Offline session created in ${Date.now() - started} ms`);
  try {
    await page.context().addCookies([fixture.cookie]);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1, name: /^(Good (morning|afternoon|evening)|We couldn’t load your workspace\.)/ })).toBeVisible({ timeout: 30_000 });
    if (await page.getByRole('heading', { name: 'We couldn’t load your workspace.', exact: true }).isVisible()) {
      throw new Error('Offline fixture GET /dashboard rendered the workspace error boundary before team data loaded.');
    }
    await expect(page.getByRole('heading', { level: 1, name: OVERVIEW })).toBeVisible({ timeout: 30_000 });
    console.log(`[fixture verification] Authenticated dashboard ready in ${Date.now() - started} ms`);
    return fixture;
  } catch (error) {
    await fixture.dispose();
    throw error;
  }
}

test('signed-out visitors are sent to the login page for protected workspaces', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Microsoft/i })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByLabel('Work email')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Explore demo/ })).toHaveAttribute('href', '/demo/dashboard');
});

test('theme choices persist across login and demo and follow the system without hydration errors', async ({ page }) => {
  const pageErrors: string[] = [];
  const hydrationErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /hydrat|did not match|didn't match/i.test(message.text())) hydrationErrors.push(message.text());
  });
  await page.goto('/login');
  const html = page.locator('html');
  await expect(html).toHaveClass(/\blight\b/);
  await page.getByRole('button', { name: 'Change theme', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Light', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
  await expect(html).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(html).toHaveClass(/\bdark\b/);
  await page.getByRole('link', { name: /Explore demo/ }).click();
  await expect(page).toHaveURL(/\/demo\/dashboard$/);
  await expect(html).toHaveClass(/\bdark\b/);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: 'Change theme', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'System', exact: true }).click();
  await expect(html).toHaveClass(/\bdark\b/);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveClass(/\blight\b/);
  await page.getByRole('button', { name: 'Change theme', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Light', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveClass(/\blight\b/);
  expect(pageErrors).toEqual([]);
  expect(hydrationErrors).toEqual([]);
});

test('demo navigation keeps every page in the demo workspace', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openDemo(page);
  const sidebar = page.locator('[data-slot="sidebar"]');
  const destinations = [
    { label: /^Daily standup/, path: 'standup', heading: /^Daily standup/ },
    { label: /^Tickets/, path: 'tickets', heading: /^Tickets/ },
    { label: /^Bugs/, path: 'bugs', heading: /^Bugs/ },
    { label: /^Approvals/, path: 'approvals', heading: /^Approvals/ },
    { label: /^Team$/, path: 'team', heading: /^Team/ },
    { label: /^Projects$/, path: 'projects', heading: /^Projects/ },
    { label: /^Settings$/, path: 'settings', heading: /^Settings/ },
    { label: /Rohan Desai/, path: 'account', heading: /^My account/ },
    { label: /^Overview$/, path: 'dashboard', heading: OVERVIEW },
  ];
  for (const destination of destinations) {
    const link = sidebar.getByRole('link', { name: destination.label });
    await expect(link).toHaveAttribute('href', `/demo/${destination.path}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/demo/${destination.path}$`));
    await expect(page.getByRole('heading', { level: 1, name: destination.heading })).toBeVisible();
    await expect(page.locator('.demo-banner')).toBeVisible();
  }
  await sidebar.getByRole('link', { name: /Urban Gabru/i }).click();
  await expect(page).toHaveURL(/\/demo\/dashboard$/);
  expect(pageErrors).toEqual([]);
});

test('ticket details render creation events that have no changed due-date payload', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openDemo(page, 'tickets');
  const title = 'Simplify the checkout address form';
  await page.getByRole('button', { name: title, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /^Timeline/ })).toBeVisible();
  await expect(dialog.locator('.timeline')).toContainText('created this ticket');
  await expect(page.getByRole('heading', { name: 'We couldn’t load your workspace.' })).toBeHidden();
  expect(pageErrors).toEqual([]);
});

test('a ticket without a due date gets one from the table, then gets more hours from the same place with a reason', async ({ page }) => {
  await openDemo(page, 'tickets');
  const title = 'Browser verification: due date from the table';
  await page.locator('.page-actions').getByRole('button', { name: 'New ticket', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Owner', exact: true }), 'Aarav Mehta');
  await dialog.getByRole('button', { name: 'Create ticket', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('textbox', { name: 'Search tickets' }).fill(title);
  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row).toContainText('No due date');
  // Setting the first due date is planning, so no reason is asked.
  await row.getByRole('button', { name: /^Set a due date for/ }).click();
  const setDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Set due date', exact: true }) });
  await expect(setDialog.getByRole('textbox', { name: 'Reason', exact: true })).toHaveCount(0);
  const day = dateKey(new Date(), 'Asia/Kolkata');
  const due = shiftDate(day, 7, 'Asia/Kolkata');
  await setDialog.getByRole('button', { name: /^Set due date to / }).click();
  await expect(setDialog).toBeHidden();
  let saved = (await readDemoData(page)).items.find(item => item.title === title);
  expect(saved).toMatchObject({ dueDate: due, originalDueDate: due });
  // An extension asks for extra hours, with a reason. The hours join the estimate and the due date moves by them.
  await row.getByRole('button', { name: /^Extend the due date of/ }).click();
  const extend = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Give this ticket more time', exact: true }) });
  await expect(extend.getByRole('spinbutton', { name: 'Extra hours needed', exact: true })).toHaveValue('2');
  await extend.getByRole('button', { name: '+4 h', exact: true }).click();
  const data = await readDemoData(page);
  const moved = dueDateAfterHours(due, 4, getWorkCalendar(data, 'demo-aarav'));
  await expect(extend.locator('.extend-preview')).toContainText('Estimate 4 h → 8 h');
  await extend.getByRole('textbox', { name: 'Reason', exact: true }).fill('Waiting for the warehouse API keys.');
  await extend.getByRole('button', { name: 'Add 4 hours', exact: true }).click();
  await expect(extend).toBeHidden();
  saved = (await readDemoData(page)).items.find(item => item.title === title);
  expect(saved).toMatchObject({ estimateHours: 8, dueDate: moved, originalDueDate: due });
  await expect(row.locator('.extension-badge')).toHaveText(`+${daysBetween(due, moved)} day${daysBetween(due, moved) === 1 ? '' : 's'}`);
});

test('a ticket needs only a title, owner and estimate, survives reload, and appears on the board', async ({ page }) => {
  await openDemo(page, 'tickets');
  const title = 'Browser verification: inventory search';
  await page.getByRole('button', { name: 'New ticket', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: 'Project', exact: true })).toHaveText(ADHOC_PROJECT.name);
  await expect(dialog.getByRole('combobox', { name: 'Phase', exact: true })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  const owner = dialog.getByRole('combobox', { name: 'Owner', exact: true });
  await owner.focus();
  await owner.press('Enter');
  // Typing searches once the list is open. The search box keeps focus; the highlighted option is marked selected.
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.type('Aarav');
  await expect(page.getByRole('option', { name: 'Aarav Mehta', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(owner).toHaveText('Aarav Mehta');
  await dialog.getByLabel(/^Estimate/).fill('4.5');
  const description = 'Match stock levels by SKU and warehouse.';
  const contextToggle = dialog.getByRole('button', { name: /^Add details/ });
  await contextToggle.click();
  await dialog.getByRole('textbox', { name: 'Description', exact: true }).fill(description);
  await contextToggle.click();
  await expect(dialog.getByRole('textbox', { name: 'Description', exact: true })).toBeHidden();
  await dialog.getByRole('button', { name: 'Create ticket', exact: true }).click();
  await expect(dialog).toBeHidden();
  const savedDescription = await page.evaluate(title => {
    const saved = localStorage.getItem('urban-gabru-kpi-demo-v7');
    if (!saved) throw new Error('Demo ticket did not persist.');
    return (JSON.parse(saved) as { items: { title: string; description: string }[] }).items.find(item => item.title === title)?.description;
  }, title);
  expect(savedDescription).toBe(description);
  const savedTask = (await readDemoData(page)).items.find(item => item.title === title);
  // Picking the owner first fills in their main project: Aarav leads Commerce.
  expect(savedTask?.projectId).toBe('demo-commerce');
  expect(savedTask?.phaseId).toBeNull();
  const search = page.getByRole('textbox', { name: 'Search tickets' });
  await search.fill(title);
  let row = page.getByRole('row').filter({ hasText: title });
  await expect(row).toContainText('4.5 h');
  await expect(row).toContainText('To do');
  // The demo user is an admin, so Complete finishes the ticket in one step.
  await row.getByRole('button', { name: /^Complete/ }).click();
  await expect(row).toContainText('Done');
  await page.reload();
  await page.getByRole('textbox', { name: 'Search tickets' }).fill(title);
  row = page.getByRole('row').filter({ hasText: title });
  await expect(row).toContainText('Done');
  await page.getByRole('radio', { name: 'Board view', exact: true }).click();
  const card = page.locator('.task-card').filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toContainText('4.5 h');
  await expect(card).toContainText('Completed');
  await page.getByRole('textbox', { name: 'Search tickets' }).fill('a search with no possible matching work 98jds');
  await expect(page.getByRole('heading', { name: 'No matches' })).toBeVisible();
  await page.getByRole('button', { name: /^Clear filters/ }).click();
  await expect(page.getByRole('heading', { name: 'No matches' })).toBeHidden();
  await expect(page.locator('.kanban-column')).toHaveCount(5);
});

test('estimate presets fill a day count in focused hours', async ({ page }) => {
  await openDemo(page, 'tickets');
  const title = 'Browser verification: day estimate';
  await page.getByRole('button', { name: 'New ticket', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  const estimate = dialog.getByRole('spinbutton', { name: /^Estimate/ });
  await dialog.getByRole('button', { name: 'Half day', exact: true }).click();
  await expect(estimate).toHaveValue('3.25');
  await dialog.getByRole('button', { name: '2 days', exact: true }).click();
  await expect(estimate).toHaveValue('13');
  await dialog.getByRole('button', { name: '1 day', exact: true }).click();
  await expect(estimate).toHaveValue('6.5');
  await expect(dialog.getByRole('button', { name: '1 day', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Create ticket', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await readDemoData(page)).items.find(item => item.title === title)?.estimateHours).toBe(6.5);
});

test('project members and custom phases can be created on mobile and edited after reload', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openDemo(page, 'projects');
  const projectName = 'Browser verification: fulfilment planning';
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Project title', exact: true }).fill(projectName);
  await dialog.getByRole('checkbox', { name: /Aarav Mehta/ }).check();
  await dialog.getByRole('checkbox', { name: /Ananya Rao/ }).check();
  for (const phase of ['Discovery', 'Delivery']) {
    await dialog.getByRole('textbox', { name: 'New phase name', exact: true }).fill(phase);
    await dialog.getByRole('button', { name: 'Add phase', exact: true }).click();
    await expect(dialog).toContainText(phase);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(dialog).toBeHidden();
  let data = await readDemoData(page);
  const project = data.projects.find(project => project.name === projectName);
  if (!project) throw new Error('The new demo project did not persist.');
  expect(project.isAdhoc).toBe(false);
  expect(project.memberIds.sort()).toEqual(['demo-aarav', 'demo-ananya']);
  expect(data.phases.filter(phase => phase.projectId === project.id).sort((a, b) => a.position - b.position).map(phase => phase.name)).toEqual(['Discovery', 'Delivery']);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.getByRole('button', { name: `Edit ${projectName}`, exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('checkbox', { name: /Aarav Mehta/ })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /Ananya Rao/ })).toBeChecked();
  await dialog.getByRole('checkbox', { name: /Aarav Mehta/ }).uncheck();
  await dialog.getByRole('checkbox', { name: /Sanya Gupta/ }).check();
  await dialog.getByRole('textbox', { name: 'Phase name: Discovery', exact: true }).fill('Planning');
  await dialog.getByRole('button', { name: 'Save phase Discovery', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Phase name: Planning', exact: true })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'New phase name', exact: true }).fill('Quality checks');
  await dialog.getByRole('button', { name: 'Add phase', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Phase name: Quality checks', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  data = await readDemoData(page);
  expect(data.projects.find(candidate => candidate.id === project.id)?.memberIds.sort()).toEqual(['demo-ananya', 'demo-sanya']);
  expect(data.phases.filter(phase => phase.projectId === project.id).sort((a, b) => a.position - b.position).map(phase => phase.name)).toEqual(['Planning', 'Delivery', 'Quality checks']);
  const adhoc = page.locator('.project-card').filter({ has: page.getByRole('button', { name: ADHOC_PROJECT.name, exact: true }) });
  await expect(adhoc).toBeVisible();
  await expect(adhoc.getByRole('button', { name: /^Edit / })).toHaveCount(0);
  await expect(adhoc.getByRole('button', { name: /^Archive$/ })).toHaveCount(0);
});

test('project selection scopes owners and phases and linked bugs inherit those choices', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await openDemo(page, 'tickets');
  const taskTitle = 'Browser verification: project-scoped payment task';
  await page.getByRole('button', { name: 'New ticket', exact: true }).click();
  let dialog = page.getByRole('dialog');
  const owner = dialog.getByRole('combobox', { name: 'Owner', exact: true });
  const phase = dialog.getByRole('combobox', { name: 'Phase', exact: true });
  await expect(dialog.getByRole('combobox', { name: 'Project', exact: true })).toHaveText(ADHOC_PROJECT.name);
  await expect(phase).toBeDisabled();
  await chooseOption(page, owner, 'Ananya Rao');
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Project', exact: true }), 'Commerce');
  await expect(owner).not.toHaveText('Ananya Rao');
  await expect(phase).toBeEnabled();
  await expect(phase).toHaveText(/Ad\s?hoc/i);
  await owner.click();
  await expect(page.getByRole('option', { name: 'Ananya Rao', exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Aarav Mehta', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'Arjun Patil', exact: true }).click();
  await phase.click();
  await expect(page.getByRole('option', { name: 'Warehouse dispatch', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'Payments reliability', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(taskTitle);
  await dialog.getByLabel(/^Estimate/).fill('2');
  await dialog.getByRole('button', { name: 'Create ticket', exact: true }).click();
  await expect(dialog).toBeHidden();
  let data = await readDemoData(page);
  const task = data.items.find(item => item.title === taskTitle);
  if (!task) throw new Error('The project-scoped demo task did not persist.');
  expect(task.projectId).toBe('demo-commerce');
  expect(task.assigneeId).toBe('demo-arjun');
  expect(data.phases.find(phase => phase.id === task.phaseId)?.name).toBe('Payments reliability');
  await page.getByRole('button', { name: taskTitle, exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.locator('.phase-tag')).toHaveText('Payments reliability');
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.goto('/demo/bugs');
  await page.getByRole('button', { name: 'Log bug', exact: true }).click();
  dialog = page.getByRole('dialog');
  const bugTitle = 'Browser verification: linked project-phase bug';
  await dialog.getByLabel('What went wrong?').fill(bugTitle);
  await chooseOption(page, dialog.getByRole('combobox', { name: /^Linked ticket/ }), `${task.key} · ${taskTitle}`);
  await expect(dialog.getByRole('combobox', { name: 'Project', exact: true })).toHaveText('Commerce');
  await expect(dialog.getByRole('combobox', { name: 'Project', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('combobox', { name: 'Phase', exact: true })).toHaveText('Payments reliability');
  await expect(dialog.getByRole('combobox', { name: 'Phase', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('combobox', { name: 'Owner', exact: true })).toHaveText('Arjun Patil');
  await dialog.getByRole('button', { name: 'Log bug', exact: true }).click();
  await expect(dialog).toBeHidden();
  data = await readDemoData(page);
  const bug = data.items.find(item => item.title === bugTitle);
  expect(bug).toMatchObject({ projectId: task.projectId, phaseId: task.phaseId, assigneeId: task.assigneeId, taskId: task.id });
  expect(pageErrors).toEqual([]);
});

test('optional date pickers clear values and restore their placeholder', async ({ page }) => {
  await openDemo(page, 'standup');
  const date = page.locator('.standup-quick-form').getByRole('button', { name: 'Due date', exact: true });
  const day = dateKey(new Date(), 'Asia/Kolkata');
  await pickDate(page, date, day);
  await date.click();
  await page.getByRole('button', { name: 'Clear date', exact: true }).click();
  await expect(date).not.toHaveAttribute('data-value');
  await expect(date).toHaveText('No due date');
});

test('comboboxes search short lists, recover from no matches, and support keyboard selection', async ({ page }) => {
  await openDemo(page, 'tickets');
  const sort = page.getByRole('combobox', { name: 'Sort tickets' });
  await sort.click();
  let search = page.getByRole('combobox', { name: 'Search options', exact: true });
  await expect(search).toBeFocused();
  await search.fill('no matching choice 932');
  await expect(page.getByText('No matches.', { exact: true })).toBeVisible();
  await search.fill('Priority');
  await expect(page.getByRole('option')).toHaveCount(1);
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(sort).toHaveText('Priority');
  await expect(sort).toBeFocused();
  await page.getByRole('link', { name: 'Bugs', exact: true }).click();
  await page.getByRole('button', { name: 'Log bug', exact: true }).click();
  const linked = page.getByRole('dialog').getByRole('combobox', { name: /^Linked ticket/ });
  await linked.click();
  search = page.getByRole('combobox', { name: 'Search options', exact: true });
  await search.fill('UG-005');
  await page.getByRole('option', { name: /UG-005/ }).click();
  await expect(linked).toContainText('UG-005');
});

test('standup quick entry supports Enter and retains the developer for the next ticket', async ({ page }) => {
  await openDemo(page, 'standup');
  const form = page.locator('.standup-quick-form');
  const developer = form.getByRole('combobox', { name: 'Owner', exact: true });
  await chooseOption(page, developer, 'Ananya Rao');
  await chooseOption(page, form.getByRole('combobox', { name: 'Project', exact: true }), 'Inventory management');
  await form.getByRole('spinbutton', { name: 'Hours', exact: true }).fill('2');
  const title = form.getByRole('textbox', { name: 'Ticket title' });
  await title.fill('Browser verification: stock count');
  await title.press('Enter');
  await expect(page.getByRole('button', { name: 'Browser verification: stock count', exact: true })).toBeVisible();
  await expect(title).toHaveValue('');
  await expect(title).toBeFocused();
  await expect(developer).toHaveText('Ananya Rao');
});

test('logging a linked bug fills its owner and project, then supports fix and verification', async ({ page }) => {
  await openDemo(page, 'bugs');
  const overdueRow = page.getByRole('row').filter({ hasText: 'Dispatch export drops one warehouse column' });
  await expect(overdueRow).toContainText('working h late');
  const title = 'Browser verification: SKU import duplicate';
  await page.getByRole('button', { name: 'Log bug', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('What went wrong?').fill(title);
  await chooseOption(page, dialog.getByRole('combobox', { name: /^Linked ticket/ }), 'UG-005 · Reconcile stock counts with the dispatch export');
  await expect(dialog.getByRole('combobox', { name: 'Owner', exact: true })).toHaveText('Ananya Rao');
  await expect(dialog.getByRole('combobox', { name: 'Project', exact: true })).toHaveText('Inventory management');
  await expect(dialog.getByRole('combobox', { name: 'Phase', exact: true })).toHaveText('Warehouse dispatch');
  await dialog.getByRole('radio', { name: 'Critical', exact: true }).click();
  await dialog.getByRole('button', { name: 'Log bug', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('textbox', { name: 'Search bugs' }).fill(title);
  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row).toContainText('Ananya');
  await expect(row).toContainText('Critical');
  await row.getByRole('button', { name: /^Mark fixed/ }).click();
  await expect(row).toContainText('Fixed');
  await row.getByRole('button', { name: /^Verify/ }).click();
  await expect(row).toContainText('Verified');
  const standaloneTitle = 'Browser verification: an issue without a source task';
  await page.getByRole('button', { name: 'Log bug', exact: true }).click();
  await dialog.getByLabel('What went wrong?').fill(standaloneTitle);
  const linkedTask = dialog.getByRole('combobox', { name: /^Linked ticket/ });
  await chooseOption(page, linkedTask, 'UG-005 · Reconcile stock counts with the dispatch export');
  await chooseOption(page, linkedTask, 'No linked ticket');
  await dialog.getByRole('button', { name: 'Log bug', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('textbox', { name: 'Search bugs' }).fill(standaloneTitle);
  await expect(page.getByRole('row').filter({ hasText: standaloneTitle })).toBeVisible();
  const storedTaskId = await page.evaluate(title => {
    const saved = localStorage.getItem('urban-gabru-kpi-demo-v7');
    if (!saved) throw new Error('Demo bug did not persist.');
    return (JSON.parse(saved) as { items: { title: string; taskId: string | null }[] }).items.find(item => item.title === title)?.taskId;
  }, standaloneTitle);
  expect(storedTaskId).toBeNull();
});

test('working-day buttons save ISO weekdays including Sunday as seven in the demo', async ({ page }) => {
  await openDemo(page, 'settings');
  for (const name of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('data-state', 'on');
  }
  const sunday = page.getByRole('button', { name: 'Sun', exact: true });
  await expect(sunday).toHaveAttribute('data-state', 'off');
  await sunday.click();
  await page.getByRole('button', { name: /^Save settings/ }).click();
  const workingDays = await page.evaluate(() => {
    const saved = localStorage.getItem('urban-gabru-kpi-demo-v7');
    if (!saved) throw new Error('Demo settings did not persist.');
    return (JSON.parse(saved) as { settings: { workingDays: number[] } }).settings.workingDays;
  });
  expect(workingDays.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 7]);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sun', exact: true })).toHaveAttribute('data-state', 'on');
});

test('mobile navigation and dialogs work at 375 pixels with keyboard focus', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openDemo(page);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const navigation = page.getByRole('dialog', { name: 'Sidebar', exact: true });
  await expect(navigation).toBeVisible();
  await navigation.getByRole('link', { name: /^Tickets/ }).click();
  await expect(page).toHaveURL(/\/demo\/tickets$/);
  await expect(navigation).toBeHidden();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(376);
  const trigger = page.getByRole('button', { name: 'New ticket', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toBeFocused();
  await expect(dialog.getByRole('combobox', { name: 'Project', exact: true })).toHaveText(ADHOC_PROJECT.name);
  await expect(dialog.getByRole('combobox', { name: 'Phase', exact: true })).toBeDisabled();
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((root) => root.contains(document.activeElement))).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('mobile-ticket-entry.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('a developer requests a ticket, asks for more hours, and completes it after the admin approves both', async ({ page }) => {
  await openDemo(page, 'tickets');
  const viewAs = page.getByRole('combobox', { name: 'View the demo as', exact: true });
  await chooseOption(page, viewAs, 'Aarav Mehta · Developer');
  await expect(page.getByRole('heading', { level: 1, name: /^My tickets/ })).toBeVisible();
  await expect(page.locator('[data-slot="sidebar"]').getByRole('link', { name: /^Team$/ })).toHaveCount(0);
  await page.locator('.page-actions').getByRole('button', { name: 'Request ticket', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Request a ticket', exact: true })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Bug', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: 'Owner', exact: true })).toHaveCount(0);
  await dialog.getByRole('combobox', { name: 'Project', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Inventory management', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'Commerce', exact: true }).click();
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Phase', exact: true }), 'Payments reliability');
  await expect(dialog).toContainText('Payment callbacks, retries, and refunds.');
  const title = 'Browser verification: webhook signature check';
  const day = dateKey(new Date(), 'Asia/Kolkata');
  const due = shiftDate(day, 7, 'Asia/Kolkata');
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await dialog.getByLabel(/^Estimate/).fill('6');
  await pickDate(page, dialog.getByRole('button', { name: /^Due date/ }), due);
  await dialog.getByRole('textbox', { name: /^Description/ }).fill('Verify webhook signatures before processing.');
  await dialog.getByRole('textbox', { name: /^Note for your admin/ }).fill('The payment provider now signs every callback.');
  await dialog.getByRole('button', { name: 'Send for approval', exact: true }).click();
  await expect(dialog).toBeHidden();
  let data = await readDemoData(page);
  const request = data.requests.find(row => row.title === title);
  if (!request) throw new Error('The ticket request did not persist.');
  expect(request).toMatchObject({ requesterId: 'demo-aarav', projectId: 'demo-commerce', estimateHours: 6, dueDate: due, status: 'pending', note: 'The payment provider now signs every callback.' });
  // A request is not a ticket until it is approved.
  expect(data.items.some(item => item.title === title)).toBe(false);
  await page.locator('[data-slot="sidebar"]').getByRole('link', { name: /^Approvals/ }).click();
  const mine = page.locator('.request-card').filter({ hasText: title });
  await expect(mine).toContainText('Waiting for approval');

  // The admin lowers the estimate while approving.
  await chooseOption(page, viewAs, 'Rohan Desai · Admin');
  const card = page.locator('.request-card').filter({ hasText: title });
  await expect(card).toContainText('Aarav Mehta');
  await expect(card).toContainText('The payment provider now signs every callback.');
  await card.getByRole('button', { name: 'Approve', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Estimate/).fill('5');
  await dialog.getByRole('textbox', { name: /^Note for Aarav/ }).fill('Five hours is enough.');
  await dialog.getByRole('button', { name: 'Approve and create ticket', exact: true }).click();
  await expect(dialog).toBeHidden();
  data = await readDemoData(page);
  const ticket = data.items.find(item => item.title === title);
  if (!ticket) throw new Error('The approved request did not create a ticket.');
  expect(ticket).toMatchObject({ assigneeId: 'demo-aarav', projectId: 'demo-commerce', estimateHours: 5, status: 'todo', dueDate: due });
  expect(data.requests.find(row => row.id === request.id)).toMatchObject({ status: 'approved', itemId: ticket.id, reviewNote: 'Five hours is enough.' });

  // Back as the developer: the request shows as approved. More hours on the ticket is a request too.
  await chooseOption(page, viewAs, 'Aarav Mehta · Developer');
  await expect(mine).toContainText('Approved');
  await mine.getByRole('button', { name: /^Open ticket/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Ask to extend/ }).click();
  const extend = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Ask for more time', exact: true }) });
  await extend.getByRole('spinbutton', { name: 'Extra hours needed', exact: true }).fill('3');
  await expect(extend.locator('.extend-preview')).toContainText('Estimate 5 h → 8 h');
  await extend.getByRole('radio', { name: 'Took longer', exact: true }).click();
  await extend.getByRole('textbox', { name: 'Reason', exact: true }).fill('Signature keys need a second review.');
  await extend.getByRole('button', { name: 'Ask for 3 hours more', exact: true }).click();
  await expect(extend).toBeHidden();
  // Nothing on the ticket changes until the admin approves.
  data = await readDemoData(page);
  expect(data.items.find(item => item.id === ticket.id)).toMatchObject({ estimateHours: 5, dueDate: due });
  const asked = data.dueDateRequests.find(row => row.itemId === ticket.id);
  expect(asked).toMatchObject({ requesterId: 'demo-aarav', fromDate: due, fromEstimate: 5, hours: 3, status: 'pending', reasonCategory: 'underestimated' });
  let drawer = page.getByRole('dialog');
  await expect(drawer.locator('.extension-waiting')).toHaveText('Asked for 3 more hours · waits for approval');
  await expect(drawer.getByRole('button', { name: /^Ask to extend/ })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Close dialog', exact: true }).click();

  // The admin approves 2 of the 3 hours.
  await chooseOption(page, viewAs, 'Rohan Desai · Admin');
  await page.locator('[data-slot="sidebar"]').getByRole('link', { name: /^Approvals/ }).click();
  const ask = page.locator('.request-card').filter({ hasText: ticket.key });
  await expect(ask).toContainText('+3 h');
  await expect(ask).toContainText('5 h → 8 h');
  await ask.getByRole('button', { name: 'Approve', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('spinbutton', { name: 'Hours to approve', exact: true }).fill('2');
  await expect(dialog).toContainText('Estimate 5 h → 7 h');
  await dialog.getByRole('textbox', { name: /^Note for Aarav/ }).fill('Two hours covers the review.');
  await dialog.getByRole('button', { name: 'Approve +2 h', exact: true }).click();
  await expect(dialog).toBeHidden();
  data = await readDemoData(page);
  const moved = dueDateAfterHours(due, 2, getWorkCalendar(data, 'demo-aarav'));
  expect(data.items.find(item => item.id === ticket.id)).toMatchObject({ estimateHours: 7, dueDate: moved, originalDueDate: due });
  expect(data.dueDateRequests.find(row => row.id === asked!.id)).toMatchObject({ status: 'approved', approvedHours: 2, reviewNote: 'Two hours covers the review.' });
  expect(data.activities.find(activity => activity.entityId === ticket.id && activity.action === 'task.due_changed'))
    .toMatchObject({ actorId: 'demo-lead', reason: 'Signature keys need a second review.', payload: { from: due, to: moved, addedHours: 2, requestedHours: 3, estimateFrom: 5, estimateTo: 7, requestedBy: 'demo-aarav' } });

  // Back as the developer: the history shows the hours, who asked, and why.
  await chooseOption(page, viewAs, 'Aarav Mehta · Developer');
  await page.locator('.request-card').filter({ hasText: ticket.key }).getByRole('button', { name: new RegExp(ticket.key) }).click();
  drawer = page.getByRole('dialog');
  await expect(drawer.locator('.extension-history')).toContainText('+2 h');
  await expect(drawer.locator('.extension-history')).toContainText('Estimate 5 h → 7 h · asked for 3 h');
  await expect(drawer.locator('.extension-history')).toContainText('Signature keys need a second review.');
  await expect(drawer.locator('.extension-history')).toContainText('Took longer');
  await expect(drawer.locator('.extension-history')).toContainText('You asked');
  // Developers complete their own tickets. The ticket then waits for the admin's review.
  await drawer.getByRole('button', { name: /^Complete/ }).click();
  await expect.poll(async () => (await readDemoData(page)).items.find(item => item.id === ticket.id)?.status).toBe('in_review');
});

test('an admin declines a ticket request with a reason the developer can read', async ({ page }) => {
  await openDemo(page, 'approvals');
  const card = page.locator('.request-card').filter({ hasText: 'Low-stock email digest for warehouse leads' });
  await card.getByRole('button', { name: 'Decline', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Decline request', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: /^Why are you declining it/ }).fill('Use the existing stock alert instead.');
  await dialog.getByRole('button', { name: 'Decline request', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await readDemoData(page)).requests.find(row => row.id === 'demo-request-2')).toMatchObject({ status: 'declined', reviewNote: 'Use the existing stock alert instead.' });
  await chooseOption(page, page.getByRole('combobox', { name: 'View the demo as', exact: true }), 'Ananya Rao · Developer');
  const mine = page.locator('.request-card').filter({ hasText: 'Low-stock email digest for warehouse leads' });
  await expect(mine).toContainText('Declined');
  await expect(mine).toContainText('Use the existing stock alert instead.');
});

test('an admin extends a project timeline with a reason and the history shows why', async ({ page }) => {
  await openDemo(page, 'projects');
  const sample = createDemoData().projects.find(project => project.id === 'demo-inventory')!;
  const later = shiftDate(sample.targetDate!, 14, 'Asia/Kolkata');
  const card = page.locator('.project-card').filter({ has: page.getByRole('button', { name: 'Inventory management', exact: true }) });
  await expect(card.locator('.extension-badge')).toHaveCount(0);
  await card.getByRole('button', { name: 'Extend', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Extend project timeline', exact: true }) });
  await dialog.getByRole('button', { name: '+2 weeks', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /^New target date/ })).toHaveAttribute('data-value', later);
  await expect(dialog).toContainText('Moves the date by 14 days');
  // The reason is required, so the dialog stays open without one.
  await dialog.getByRole('button', { name: /^Extend to / }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: 'Scope grew', exact: true }).click();
  const reason = 'The warehouse team added barcode labels to the scope.';
  await dialog.getByRole('textbox', { name: 'Reason', exact: true }).fill(reason);
  await dialog.getByRole('button', { name: /^Extend to / }).click();
  await expect(dialog).toBeHidden();
  const data = await readDemoData(page);
  expect(data.projects.find(project => project.id === sample.id)).toMatchObject({ targetDate: later, originalTargetDate: sample.originalTargetDate });
  expect(data.activities.find(activity => activity.entityId === sample.id && activity.action === 'project.target_changed'))
    .toMatchObject({ reason, payload: { from: sample.targetDate, to: later, reasonCategory: 'scope_change' } });
  await expect(card.locator('.extension-badge')).toHaveText('+14 days');
  await card.getByRole('button', { name: 'Inventory management', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: /^Timeline changes/ })).toBeVisible();
  await expect(drawer.locator('.extension-history li')).toHaveCount(1);
  await expect(drawer.locator('.extension-history')).toContainText(reason);
  await expect(drawer.locator('.extension-history')).toContainText('Scope grew');
  await expect(drawer.locator('.burnup-chart .recharts-surface').first()).toBeVisible();
  await page.reload();
  await expect(card.locator('.extension-badge')).toHaveText('+14 days');
});

test('hours are added, never rewritten, on a ticket without a due date', async ({ page }) => {
  await openDemo(page, 'tickets');
  const title = 'Browser verification: add hours without a due date';
  await page.locator('.page-actions').getByRole('button', { name: 'New ticket', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Owner', exact: true }), 'Aarav Mehta');
  await dialog.getByRole('button', { name: 'Create ticket', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('textbox', { name: 'Search tickets' }).fill(title);
  await page.getByRole('button', { name: title, exact: true }).click();
  let drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('button', { name: /^Revise/ })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Add hours', exact: true }).click();
  dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Give this ticket more time', exact: true }) });
  await expect(dialog).toContainText('No due date');
  await dialog.getByRole('button', { name: '+2 h', exact: true }).click();
  await expect(dialog.locator('.extend-preview')).toContainText('Estimate 4 h → 6 h');
  await dialog.getByRole('radio', { name: 'Scope grew', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Reason', exact: true }).fill('The client added an export button.');
  await dialog.getByRole('button', { name: 'Add 2 hours', exact: true }).click();
  await expect(dialog).toBeHidden();
  let data = await readDemoData(page);
  const ticket = data.items.find(item => item.title === title)!;
  expect(ticket).toMatchObject({ estimateHours: 6, dueDate: null });
  expect(data.activities.find(activity => activity.entityId === ticket.id && activity.action === 'task.hours_added'))
    .toMatchObject({ reason: 'The client added an export button.', payload: { addedHours: 2, estimateFrom: 4, estimateTo: 6, reasonCategory: 'scope_change' } });
  drawer = page.getByRole('dialog');
  await expect(drawer.locator('.timeline')).toContainText('added 2 more hours, so the estimate went from 4 h to 6 h');
  await drawer.getByRole('button', { name: 'Close dialog', exact: true }).click();

  // The developer asks for hours on the same ticket. It waits for the admin.
  await chooseOption(page, page.getByRole('combobox', { name: 'View the demo as', exact: true }), 'Aarav Mehta · Developer');
  await page.getByRole('textbox', { name: 'Search tickets' }).fill(title);
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ask for hours', exact: true }).click();
  dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Ask for more time', exact: true }) });
  await dialog.getByRole('button', { name: '+1 h', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Reason', exact: true }).fill('The export needs a CSV and a PDF.');
  await dialog.getByRole('button', { name: 'Ask for 1 hour more', exact: true }).click();
  await expect(dialog).toBeHidden();
  data = await readDemoData(page);
  expect(data.items.find(item => item.id === ticket.id)?.estimateHours).toBe(6);
  expect(data.dueDateRequests.find(row => row.itemId === ticket.id)).toMatchObject({ fromDate: null, fromEstimate: 6, hours: 1, status: 'pending' });
});

test('more hours that push a ticket past its project target warn before saving', async ({ page }) => {
  await openDemo(page, 'tickets');
  const title = 'Add retry handling for failed payment callbacks';
  // Demo dates follow today, so find enough hours to cross the Commerce target. Nothing has changed yet, so use the starting data.
  const data = createDemoData();
  const item = data.items.find(row => row.title === title)!;
  const target = data.projects.find(project => project.id === item.projectId)!.targetDate!;
  const calendar = getWorkCalendar(data, item.assigneeId);
  const late = [8, 16, 24, 40, 60].find(hours => dueDateAfterHours(item.dueDate!, hours, calendar) > target);
  if (!late) throw new Error('No hours value crosses the project target.');
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Extend/ }).click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Give this ticket more time', exact: true }) });
  await expect(dialog).toContainText('Extended before');
  await dialog.getByRole('button', { name: '+1 h', exact: true }).click();
  await expect(dialog.locator('.extend-warning')).toHaveCount(0);
  await dialog.getByRole('spinbutton', { name: 'Extra hours needed', exact: true }).fill(String(late));
  await expect(dialog.locator('.extend-warning')).toContainText('after the Commerce target date');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('overview charts render with table twins and a project timeline row opens its project', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openDemo(page);
  await expect(page.locator('.trend-chart .recharts-surface').first()).toBeVisible();
  await expect(page.locator('.trend-panel table.sr-only tbody tr')).toHaveCount(7);
  await expect(page.locator('.trend-stats')).toContainText('Best week');
  await expect(page.locator('.highlights .highlight')).toHaveCount(3);
  const rows = page.locator('.gantt-row');
  await expect(rows).toHaveCount(4);
  await expect(page.locator('.gantt table.sr-only tbody tr')).toHaveCount(4);
  await expect(page.locator('.streak-badge').first()).toBeVisible();
  await rows.filter({ hasText: 'Creator marketplace' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: 'Creator marketplace', exact: true })).toBeVisible();
  await expect(drawer.locator('.extension-history li')).toHaveCount(2);
  await expect(drawer.locator('.extension-badge')).toHaveText('+14 days · 2×');
  expect(pageErrors).toEqual([]);
});

test('a developer reads why their project moved but cannot extend it', async ({ page }) => {
  await openDemo(page, 'projects');
  await chooseOption(page, page.getByRole('combobox', { name: 'View the demo as', exact: true }), 'Aarav Mehta · Developer');
  const card = page.locator('.project-card').filter({ has: page.getByRole('button', { name: 'Commerce', exact: true }) });
  await expect(card.locator('.extension-badge')).toHaveText('+7 days');
  await expect(card.getByRole('button', { name: 'Extend', exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: 'Commerce', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.locator('.extension-history')).toContainText('callback format');
  await expect(drawer.getByRole('button', { name: /Extend/ })).toHaveCount(0);
});

test('an admin records several days of leave from the team table and sees one range', async ({ page }) => {
  await openDemo(page, 'team');
  await expect(page.locator('.member-table .person-text').first()).toHaveCSS('flex-direction', 'column');
  const nextMonday = shiftDate(getWeekStart(new Date(), 'Asia/Kolkata'), 7, 'Asia/Kolkata');
  const friday = shiftDate(nextMonday, 4, 'Asia/Kolkata');
  const monday = shiftDate(nextMonday, 7, 'Asia/Kolkata');
  const tuesday = shiftDate(nextMonday, 8, 'Asia/Kolkata');
  await page.getByRole('button', { name: 'Add leave for Ananya Rao', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('checkbox', { name: 'Ananya Rao', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(1);
  await pickDateRange(page, dialog.getByRole('button', { name: /^Dates/ }), friday, tuesday);
  await expect(dialog.getByRole('radio', { name: 'Half day', exact: true })).toBeDisabled();
  // Friday to Tuesday skips the weekend: three working days.
  await expect(dialog).toContainText('3 working days');
  await dialog.getByRole('button', { name: 'Add leave', exact: true }).click();
  await expect(dialog).toBeHidden();
  const data = await readDemoData(page);
  expect(data.leaves.filter(leave => leave.userId === 'demo-ananya').map(leave => leave.date).sort()).toEqual([friday, monday, tuesday]);
  const row = page.locator('.availability-row').filter({ hasText: 'Ananya Rao' });
  await expect(row).toContainText('3 days');
  await row.getByRole('button', { name: /^Remove/ }).click();
  await row.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(row).toBeHidden();
  expect((await readDemoData(page)).leaves.filter(leave => leave.userId === 'demo-ananya')).toEqual([]);
});

test.describe('date-only labels in other browser timezones', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('a ticket due date stays on the India calendar date in a Los Angeles browser', async ({ page }) => {
    const title = 'Simplify the checkout address form';
    const dueDate = createDemoData().items.find((item) => item.title === title)?.dueDate;
    if (!dueDate) throw new Error('The known demo ticket needs a due date.');
    const expected = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
      .format(new Date(`${dueDate}T12:00:00Z`));
    await openDemo(page, 'tickets');
    const row = page.getByRole('row').filter({ hasText: title });
    await expect(row.locator('.due-date')).toHaveText(expected);
  });
});

test.describe('local fixture authentication — Microsoft OAuth is not exercised', () => {
  test('an offline admin session has private workspace access and can sign out', async ({ page }) => {
    const fixture = await authenticateWithFixture(page);
    try {
    const response = await page.request.get('/api/data');
    expect(response.status()).toBe(200);
    const identity = (await response.json() as { currentUser: { id: string; role: string; isActive: boolean } }).currentUser;
    await expect(page.getByRole('heading', { level: 1, name: OVERVIEW })).toBeVisible();
    await expect(page.getByText('Live workspace', { exact: true })).toBeVisible();
    await expect(page.locator('.demo-banner')).toBeHidden();
    expect(identity.role).toBe('admin');
    expect(identity.isActive).toBe(true);
    expect(identity.id).toBe(fixture.userId);
    await expect(page.locator('[data-slot="sidebar"]').getByRole('link', { name: /^Team$/ })).toBeVisible();
    await page.getByRole('link', { name: 'Open my account' }).click();
    await page.getByRole('button', { name: /^Sign out/ }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get('/api/data')).status()).toBe(401);
    } finally { await fixture.dispose(); }
  });

  test('live ticket and linked bug entry pass through the API to Neon and render after reload', async ({ page }) => {
    test.setTimeout(120_000);
    const started = Date.now();
    const prefix = `Browser verification ${randomUUID()}`;
    const taskTitle = `${prefix} task`;
    const bugTitle = `${prefix} bug`;
    const createdIds = new Set<string>();
    let actorId: string | undefined;
    let fixture: OfflineFixture | undefined;
    // Admins own no tickets, so the test brings its own temporary developer as the owner.
    let owner: { userId: string; member: { name: string }; dispose(): Promise<void> } | undefined;
    type Item = { id: string; key: string; title: string; type: string; status: string; estimateHours: number; dueDate: string | null; originalDueDate: string | null; projectId: string; phaseId: string | null; assigneeId: string; taskId: string | null };
    const readItems = async () => {
      const response = await page.request.get('/api/data');
      expect(response.status()).toBe(200);
      return (await response.json() as { items: Item[] }).items;
    };
    try {
      fixture = await authenticateWithFixture(page);
      actorId = fixture.userId;
      const { createOfflineSessionFixture } = await import('../src/server/verification-fixtures');
      owner = await createOfflineSessionFixture({ baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3100', role: 'developer', name: `Browser verification developer ${randomUUID().slice(0, 6)}` });
      page.setDefaultTimeout(15_000);
      page.setDefaultNavigationTimeout(45_000);
      await page.goto('/tickets');
      await expect(page.getByRole('heading', { level: 1, name: /^Tickets/ })).toBeVisible({ timeout: 10_000 });
      // An empty workspace also shows New ticket in its empty state. Use the page action.
      await page.locator('.page-actions').getByRole('button', { name: 'New ticket', exact: true }).click();
      let dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('combobox', { name: 'Project', exact: true })).toHaveText(ADHOC_PROJECT.name);
      await expect(dialog.getByRole('combobox', { name: 'Phase', exact: true })).toBeDisabled();
      await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(taskTitle);
      await chooseOption(page, dialog.getByRole('combobox', { name: 'Owner', exact: true }), owner.member.name);
      const projectLabel = await dialog.getByRole('combobox', { name: 'Project', exact: true }).innerText();
      await dialog.getByLabel(/^Estimate/).fill('2');
      await saveLiveForm(page, dialog, 'Create ticket');
      const task = (await readItems()).find((item) => item.title === taskTitle);
      if (!task) throw new Error('The created task did not persist in Neon.');
      createdIds.add(task.id);
      expect(task.estimateHours).toBe(2);
      expect(task.assigneeId).toBe(owner.userId);
      expect(task.projectId).toBe(ADHOC_PROJECT.id);
      expect(task.phaseId).toBeNull();
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: /^Tickets/ })).toBeVisible({ timeout: 10_000 });
      await page.getByRole('textbox', { name: 'Search tickets' }).fill(taskTitle);
      const row = page.getByRole('row').filter({ hasText: taskTitle });
      await expect(row).toContainText('2 h');
      await row.getByRole('button', { name: taskTitle, exact: true }).click();
      // Adding hours never rewrites the estimate. It adds to it, with a reason. With no due date, only the estimate changes.
      await page.getByRole('button', { name: 'Add hours', exact: true }).click();
      dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Give this ticket more time', exact: true }) });
      await dialog.getByRole('button', { name: '+1 h', exact: true }).click();
      await expect(dialog.locator('.extend-preview')).toContainText('only the estimate changes');
      await dialog.getByRole('textbox', { name: 'Reason', exact: true }).fill('Additional scope agreed during browser verification');
      await saveLiveForm(page, dialog, 'Add 1 hour');
      expect((await readItems()).find((item) => item.id === task.id)?.estimateHours).toBe(3);
      // The first due date is planning. More hours later is an extension and needs a reason.
      const firstDue = shiftDate(dateKey(new Date(), 'Asia/Kolkata'), 3, 'Asia/Kolkata');
      await page.getByRole('dialog').getByRole('button', { name: /^Set date/ }).click();
      dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Set due date', exact: true }) });
      await pickDate(page, dialog.getByRole('button', { name: /^Due date/ }), firstDue);
      await saveLiveForm(page, dialog, /^Set due date to /);
      await page.getByRole('dialog').getByRole('button', { name: /^Extend/ }).click();
      dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Give this ticket more time', exact: true }) });
      await dialog.getByRole('button', { name: '+8 h', exact: true }).click();
      await dialog.getByRole('textbox', { name: 'Reason', exact: true }).fill('Waiting for the payment sandbox during browser verification');
      await saveLiveForm(page, dialog, 'Add 8 hours');
      const extended = (await readItems()).find((item) => item.id === task.id);
      expect(extended?.estimateHours).toBe(11);
      expect(extended?.dueDate && extended.dueDate > firstDue).toBe(true);
      expect(extended?.originalDueDate).toBe(firstDue);
      await expect(page.getByRole('dialog').locator('.extension-history')).toContainText('Waiting for the payment sandbox');
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      // Status changes show before the server answers.
      const startedAt = Date.now();
      await row.getByRole('button', { name: /^Complete/ }).click();
      await expect(row.getByText('Done', { exact: true })).toBeVisible({ timeout: 1_500 });
      console.log(`[live verification] Complete shown in ${Date.now() - startedAt} ms`);
      await expect.poll(async () => (await readItems()).find((item) => item.id === task.id)?.status, { timeout: 30_000 }).toBe('done');
      await page.goto('/bugs');
      await expect(page.getByRole('heading', { level: 1, name: /^Bugs/ })).toBeVisible({ timeout: 10_000 });
      await page.locator('.page-actions').getByRole('button', { name: 'Log bug', exact: true }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByLabel('What went wrong?').fill(bugTitle);
      await chooseOption(page, dialog.getByRole('combobox', { name: /^Linked ticket/ }), `${task.key} · ${taskTitle}`);
      await expect(dialog.getByRole('combobox', { name: 'Owner', exact: true })).toHaveText(owner.member.name);
      await expect(dialog.getByRole('combobox', { name: 'Project', exact: true })).toHaveText(projectLabel.trim());
      await saveLiveForm(page, dialog, 'Log bug');
      const bug = (await readItems()).find((item) => item.title === bugTitle);
      if (!bug) throw new Error('The created bug did not persist in Neon.');
      createdIds.add(bug.id);
      expect(bug.type).toBe('bug');
      expect(bug.taskId).toBe(task.id);
      expect(bug.projectId).toBe(task.projectId);
      expect(bug.phaseId).toBeNull();
      await page.getByRole('textbox', { name: 'Search bugs' }).fill(bugTitle);
      await expect(page.getByRole('row').filter({ hasText: bugTitle })).toBeVisible();
    } catch (error) {
      console.log(`[live verification] Failed before cleanup at ${Date.now() - started} ms: ${error instanceof Error ? error.message.split('\n')[0] : 'Unknown error'}`);
      throw error;
    } finally {
      try {
      if (actorId) {
        const { config } = await import('dotenv');
        config({ path: resolve('.env.local'), quiet: true });
        const { Pool } = await import('pg');
        const cleanup = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15_000, query_timeout: 15_000 });
        try {
          await cleanup.query('BEGIN');
          // Recover IDs if a UI failure happened after the server committed its response.
          const owned = await cleanup.query<{ id: string }>('SELECT id FROM tech_kpi_work_item WHERE created_by_id = $1 AND title = ANY($2::text[])', [actorId, [taskTitle, bugTitle]]);
          owned.rows.forEach((item) => createdIds.add(item.id));
          if (createdIds.size) {
            const ids = [...createdIds];
            await cleanup.query('DELETE FROM tech_kpi_attachment WHERE item_id = ANY($1::uuid[])', [ids]);
            await cleanup.query('DELETE FROM tech_kpi_activity WHERE entity_id = ANY($1::text[])', [ids]);
            await cleanup.query('DELETE FROM tech_kpi_work_item WHERE id = ANY($1::uuid[])', [ids]);
          }
          await cleanup.query('COMMIT');
          console.log('[live verification] Temporary item cleanup committed');
        } catch (error) {
          await cleanup.query('ROLLBACK');
          throw error;
        } finally { await cleanup.end(); }
      }
      } finally { await owner?.dispose(); await fixture?.dispose(); console.log('[live verification] Temporary identity cleanup completed'); }
    }
  });
});

test('an admin gives every developer the same half day of leave in one step', async ({ page }) => {
  await openDemo(page, 'team');
  const nextMonday = shiftDate(getWeekStart(new Date(), 'Asia/Kolkata'), 7, 'Asia/Kolkata');
  await page.getByRole('button', { name: 'Add leave', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Choose who is on leave.');
  await dialog.getByRole('button', { name: 'Select all', exact: true }).click();
  const developers = createDemoData().members.filter(m => m.isActive && m.role === 'developer');
  await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(developers.length);
  await pickDateRange(page, dialog.getByRole('button', { name: /^Dates/ }), nextMonday, nextMonday);
  await dialog.getByRole('radio', { name: 'Half day', exact: true }).click();
  await expect(dialog).toContainText(`${developers.length} developers’ hours at work`);
  await dialog.getByRole('button', { name: `Add leave for ${developers.length}`, exact: true }).click();
  await expect(dialog).toBeHidden();
  const leaves = (await readDemoData(page)).leaves.filter(leave => leave.date === nextMonday);
  expect(leaves.map(leave => leave.userId).sort()).toEqual(developers.map(m => m.id).sort());
  expect(leaves.every(leave => leave.type === 'half_day')).toBe(true);
});

test('a team event becomes finished work for every chosen developer', async ({ page }) => {
  await openDemo(page, 'team');
  const title = 'Browser verification: quarterly planning';
  await page.getByRole('button', { name: 'Team ticket', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio', { name: 'Event already held', exact: true })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  // Every active developer starts selected. One is left out.
  const developers = createDemoData().members.filter(m => m.isActive && m.role === 'developer');
  await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(developers.length);
  const [skipped, ...chosen] = developers;
  await dialog.getByRole('checkbox', { name: skipped.name, exact: true }).click();
  await dialog.getByRole('button', { name: '1 day', exact: true }).click();
  await dialog.getByRole('button', { name: `Add for ${chosen.length} developers`, exact: true }).click();
  await expect(dialog).toBeHidden();
  const saved = (await readDemoData(page)).items.filter(item => item.title === title);
  expect(saved.map(item => item.assigneeId).sort()).toEqual(chosen.map(m => m.id).sort());
  for (const item of saved) {
    expect(item).toMatchObject({ type: 'task', status: 'done', estimateHours: 6.5, dueDate: null });
    expect(item.completedAt && new Date(item.completedAt) <= new Date()).toBe(true);
  }
});

test('team work to do follows the project members', async ({ page }) => {
  await openDemo(page, 'team');
  const title = 'Browser verification: security training';
  const data = createDemoData();
  const project = data.projects.find(p => !p.isAdhoc && p.memberIds.length > 1)!;
  await page.getByRole('button', { name: 'Team ticket', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Work to do', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Project', exact: true }), project.name);
  const members = data.members.filter(m => m.isActive && m.role === 'developer' && project.memberIds.includes(m.id));
  await expect(dialog.getByRole('checkbox')).toHaveCount(members.length);
  await dialog.getByRole('button', { name: `Add for ${members.length} developer${members.length === 1 ? '' : 's'}`, exact: true }).click();
  await expect(dialog).toBeHidden();
  const saved = (await readDemoData(page)).items.filter(item => item.title === title);
  expect(saved.map(item => item.assigneeId).sort()).toEqual(members.map(m => m.id).sort());
  expect(saved.every(item => item.status === 'todo' && item.projectId === project.id && item.estimateHours === 4)).toBe(true);
});

test('a half-day holiday is listed and saved as a half day', async ({ page }) => {
  await openDemo(page, 'settings');
  const nextMonday = shiftDate(getWeekStart(new Date(), 'Asia/Kolkata'), 7, 'Asia/Kolkata');
  await page.getByRole('button', { name: 'Add holiday', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Holiday name', exact: true }).fill('Founders day');
  await pickDate(page, dialog.getByRole('button', { name: /^Date/ }), nextMonday);
  await dialog.getByRole('radio', { name: 'Half day', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add holiday', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await readDemoData(page)).holidays).toContainEqual(expect.objectContaining({ name: 'Founders day', date: nextMonday, type: 'half_day' }));
  await expect(page.locator('.holiday-list')).toContainText('Founders dayHalf day');
});
