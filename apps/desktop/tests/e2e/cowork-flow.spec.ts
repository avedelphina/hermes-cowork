// apps/desktop/tests/e2e/cowork-flow.spec.ts
// Drives the Cowork plan-then-approve flow end to end against a REAL Hermes +
// live model. Slow (~20s) and requires a configured Hermes on PATH — run with
// `pnpm test:e2e`, skipped automatically when Hermes is absent.
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { existsSync as fileExists, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const hermesPresent = ['/.local/bin/hermes', '/opt/homebrew/bin/hermes', '/usr/local/bin/hermes']
  .some((p) => fileExists(p.startsWith('/.') ? homedir() + p : p));

test('cowork: propose plan → approve → execute', async () => {
  test.skip(!hermesPresent, 'requires a configured Hermes on PATH');
  test.setTimeout(240_000);
  const work = path.join('/tmp', 'cowork-ui-test');
  rmSync(path.join(work, 'hello.txt'), { force: true });
  mkdirSync(work, { recursive: true });

  // The dev shell exports ELECTRON_RUN_AS_NODE=1, which makes Electron reject
  // its own CLI flags — strip it for the real GUI launch.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.HERMES_COWORK_USERDATA = path.join(work, '.userdata'); // isolate projects/tasks stores

  const app = await electron.launch({
    args: [path.join(__dirname, '../../out/main/index.js')],
    env,
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('body')).toContainText(/Chat|Cowork/, { timeout: 20_000 });

  const shot = (name: string) => win.screenshot({ path: `/tmp/cowork-ui-test/${name}.png` });

  // Into Cowork → New task
  await win.getByRole('link', { name: 'Cowork' }).click();
  await shot('01-cowork');
  await win.getByRole('link', { name: /New task/i }).click();
  await shot('02-newtask');

  await win.getByPlaceholder(/Pull Q2 metrics|e\.g\./i).fill(
    'Create a file called hello.txt containing the single word hello',
  );
  await win.locator('input[placeholder*="/Users/x/work"]').fill(work);
  await shot('03-filled');

  await win.getByRole('button', { name: /Start task/i }).click();

  // The agent proposes a plan and stops at the Approve gate.
  const approve = win.getByRole('button', { name: /Approve & run/i });
  await expect(approve).toBeVisible({ timeout: 120_000 });
  await expect(win.locator('ol > li')).not.toHaveCount(0); // parsed steps in Plan tab
  await shot('04-plan');

  await approve.click();
  await expect(win.locator('body')).toContainText(/approved/i, { timeout: 10_000 });

  // Execution begins and the agent asks to approve the file edit.
  const editApproval = win.getByRole('button', { name: /^Approve$/ });
  await expect(editApproval).toBeVisible({ timeout: 60_000 });
  await shot('05-edit-approval');
  await editApproval.click();

  // The approved edit lands on disk.
  await expect
    .poll(() => existsSync(path.join(work, 'hello.txt')), { timeout: 60_000 })
    .toBe(true);
  expect(readFileSync(path.join(work, 'hello.txt'), 'utf8').trim()).toBe('hello');
  await shot('06-done');

  // The task is persisted and resumable: leave, come back via the Tasks list.
  await win.getByRole('link', { name: /Tasks/ }).click();
  const taskRow = win.locator('li', { hasText: 'hello.txt containing the single word hello' });
  await expect(taskRow).toBeVisible();
  await taskRow.getByRole('button', { name: /Open|Resume/ }).click();
  // session/load replays the conversation into the (initially empty) transcript.
  const transcript = win.locator('.flex-1.overflow-y-auto').first();
  await expect(transcript).toContainText(/Proceed with the plan|Verify the file exists/i, { timeout: 60_000 });
  await shot('07-resumed');

  await app.close();
});
