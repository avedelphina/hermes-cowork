// apps/desktop/tests/e2e/projects.spec.ts
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

test('projects: create from folder, activate, prefill New task, browse files', async () => {
  test.setTimeout(60_000);
  const work = path.join('/tmp', 'proj-e2e-' + Date.now());
  mkdirSync(work, { recursive: true });
  writeFileSync(path.join(work, 'README.md'), '# demo project\nhello from readme\n');
  writeFileSync(path.join(work, 'AGENTS.md'), 'project rules\n');

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // Isolate the projects.json for this run.
  env.HERMES_COWORK_USERDATA = path.join(work, '.userdata');

  const app = await electron.launch({ args: [path.join(__dirname, '../../out/main/index.js')], env });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('body')).toContainText(/Chat|Cowork/, { timeout: 20_000 });

  // Title bar shows "No project" → click it to open the Projects page.
  await win.getByRole('link', { name: /No project/i }).click();
  await expect(win.getByRole('heading', { name: 'Projects' })).toBeVisible();

  await win.getByRole('button', { name: /New project/i }).click();
  await win.getByPlaceholder('/Users/x/work/site').fill(work);
  await win.getByPlaceholder('Site redesign').fill('E2E Project');
  await win.getByRole('button', { name: /Create project/i }).click();

  // Project appears and is active, with its context files detected.
  const row = win.locator('li', { hasText: 'E2E Project' });
  await expect(row).toBeVisible();
  await expect(row).toContainText(work);
  await expect(row).toContainText('AGENTS.md');
  await expect(win.getByRole('link', { name: /E2E Project/i })).toBeVisible(); // title bar chip

  // New task dialog prefills the folder from the active project.
  await win.getByRole('link', { name: 'Cowork' }).click();
  await win.getByRole('link', { name: /New task/i }).click();
  await expect(win.locator(`input[value="${work}"]`)).toBeVisible();

  // File browser (Cowork right pane) lists and previews project files.
  await win.getByRole('link', { name: /Current task/ }).click();
  await win.getByRole('button', { name: 'Files', exact: true }).click();
  await win.getByRole('button', { name: /README\.md/ }).click();
  await expect(win.locator('pre')).toContainText('hello from readme');

  // Rename + archive round-trip.
  await win.getByRole('link', { name: /Projects/i }).first().click();
  await win.getByRole('button', { name: 'Rename' }).click();
  await win.locator('input[value="E2E Project"]').fill('Renamed Project');
  await win.keyboard.press('Enter');
  await expect(win.locator('li', { hasText: 'Renamed Project' })).toBeVisible();

  // Profiles manager reachable from the profile dropdown.
  await win.getByRole('button', { name: 'Profile menu' }).click();
  await win.getByRole('link', { name: /Manage profiles/i }).click();
  await expect(win.getByRole('heading', { name: 'Profiles' })).toBeVisible();
  await expect(win.getByText('New profile name')).toBeVisible();

  // Hermes read-only surfaces render real data.
  await win.getByRole('link', { name: /Skills/ }).click();
  await expect(win.getByRole('heading', { name: 'Skills' })).toBeVisible();
  await expect(win.locator('li').first()).toBeVisible();
  await win.getByRole('link', { name: /Cron/ }).click();
  await expect(win.getByRole('heading', { name: 'Cron jobs' })).toBeVisible();

  // Code mode: project file tree + a message composer.
  await win.getByRole('link', { name: 'Code' }).click();
  await expect(win.getByRole('button', { name: /README\.md/ })).toBeVisible();
  await expect(win.getByRole('textbox', { name: 'Message input' })).toBeVisible();

  await win.getByRole('link', { name: /Projects/i }).first().click();
  await win.locator('li', { hasText: 'Renamed Project' }).getByRole('button', { name: 'Archive' }).click();
  await expect(win.getByText('Archived', { exact: true })).toBeVisible();
  await expect(win.getByRole('link', { name: /No project/i })).toBeVisible(); // chip cleared

  await app.close();
  rmSync(work, { recursive: true, force: true });
});
