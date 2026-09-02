// apps/desktop/tests/e2e/screenshot.spec.ts
// Regenerates docs/screenshots/*.png. Run: pnpm exec playwright test screenshot
import { test, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { existsSync as fileExists, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const hermesPresent = ['/.local/bin/hermes', '/opt/homebrew/bin/hermes', '/usr/local/bin/hermes']
  .some((p) => fileExists(p.startsWith('/.') ? homedir() + p : p));
const shots = path.join(__dirname, '../../../..', 'docs', 'screenshots');

test('regenerate docs screenshots', async () => {
  test.skip(!hermesPresent, 'requires a configured Hermes on PATH');
  test.setTimeout(240_000);
  const work = path.join('/tmp', 'shot-e2e');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  writeFileSync(path.join(work, 'README.md'), '# Demo project\n\nWorking notes.\n');
  writeFileSync(path.join(work, 'AGENTS.md'), 'Keep changes small.\n');

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.HERMES_COWORK_USERDATA = path.join(work, '.userdata');

  const app = await electron.launch({ args: [path.join(__dirname, '../../out/main/index.js')], env });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.setViewportSize({ width: 1280, height: 800 });
  await win.locator('body').getByText(/Chat|Cowork/).first().waitFor({ timeout: 20_000 });

  await win.getByRole('link', { name: 'Cowork' }).click();
  await win.getByRole('link', { name: /New task/i }).click();
  await win.getByPlaceholder(/Pull Q2 metrics|e\.g\./i).fill(
    'Add a --version flag to the CLI and cover it with a test.',
  );
  await win.locator('input[placeholder*="/Users/x/work"]').fill(work);
  await win.getByRole('button', { name: /Start task/i }).click();

  await win.getByRole('button', { name: /Approve & run/i }).waitFor({ timeout: 120_000 });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(shots, 'cowork.png') });

  await app.close();
  rmSync(work, { recursive: true, force: true });
});
