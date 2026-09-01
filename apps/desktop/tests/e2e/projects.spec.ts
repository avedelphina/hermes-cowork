// apps/desktop/tests/e2e/projects.spec.ts
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

test('projects: create from folder, activate, prefill New task', async () => {
  test.setTimeout(60_000);
  const work = path.join('/tmp', 'proj-e2e-' + Date.now());
  mkdirSync(work, { recursive: true });

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

  // Project appears and is active.
  const row = win.locator('li', { hasText: 'E2E Project' });
  await expect(row).toBeVisible();
  await expect(row).toContainText(work);
  await expect(win.getByRole('link', { name: /E2E Project/i })).toBeVisible(); // title bar chip

  // New task dialog prefills the folder from the active project.
  await win.getByRole('link', { name: 'Cowork' }).click();
  await win.getByRole('link', { name: /New task/i }).click();
  await expect(win.locator(`input[value="${work}"]`)).toBeVisible();

  await app.close();
  rmSync(work, { recursive: true, force: true });
});
