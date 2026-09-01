// apps/desktop/tests/e2e/multi-agent.spec.ts
// Definition-of-done #11: two bounded workers run in parallel, show independent
// progress, and their outputs are synthesised into the coordinator.
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { existsSync as fileExists, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const hermesPresent = ['/.local/bin/hermes', '/opt/homebrew/bin/hermes', '/usr/local/bin/hermes']
  .some((p) => fileExists(p.startsWith('/.') ? homedir() + p : p));

test('multi-agent: two parallel workers + synthesis', async () => {
  test.skip(!hermesPresent, 'requires a configured Hermes on PATH');
  test.setTimeout(300_000);
  const work = path.join('/tmp', 'ma-e2e');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.HERMES_COWORK_USERDATA = path.join(work, '.userdata');

  const app = await electron.launch({ args: [path.join(__dirname, '../../out/main/index.js')], env });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('body')).toContainText(/Chat|Cowork/, { timeout: 20_000 });

  // Start a coordinator task.
  await win.getByRole('link', { name: 'Cowork' }).click();
  await win.getByRole('link', { name: /New task/i }).click();
  await win.getByPlaceholder(/Pull Q2 metrics|e\.g\./i).fill('Coordinate two file-creation subtasks.');
  await win.locator('input[placeholder*="/Users/x/work"]').fill(work);
  await win.getByRole('button', { name: /Start task/i }).click();

  await win.getByRole('button', { name: /Approve & run/i }).click({ timeout: 120_000 });
  await expect(win.locator('body')).toContainText(/approved/i, { timeout: 10_000 });

  // Dispatch two workers from the Subtasks tab.
  await win.getByRole('button', { name: 'Subtasks', exact: true }).click();
  const goal = win.getByRole('textbox', { name: 'Worker goal' });
  await goal.fill(`Create a file named ${path.join(work, 'alpha.txt')} containing exactly the word alpha. Then stop.`);
  await win.getByRole('button', { name: 'Dispatch' }).click();
  await goal.fill(`Create a file named ${path.join(work, 'beta.txt')} containing exactly the word beta. Then stop.`);
  await win.getByRole('button', { name: 'Dispatch' }).click();

  // Both run independently and produce their files.
  await expect
    .poll(() => existsSync(path.join(work, 'alpha.txt')) && existsSync(path.join(work, 'beta.txt')), { timeout: 180_000 })
    .toBe(true);
  expect(readFileSync(path.join(work, 'alpha.txt'), 'utf8')).toContain('alpha');
  expect(readFileSync(path.join(work, 'beta.txt'), 'utf8')).toContain('beta');

  // Both workers report done, then synthesise.
  await expect(win.getByText('● done')).toHaveCount(2, { timeout: 60_000 });
  await win.getByRole('button', { name: /Synthesise results/i }).click();
  const transcript = win.locator('.flex-1.overflow-y-auto').first();
  await expect(transcript).toContainText(/alpha/i, { timeout: 90_000 });
  await expect(transcript).toContainText(/beta/i);

  await app.close();
  rmSync(work, { recursive: true, force: true });
});
