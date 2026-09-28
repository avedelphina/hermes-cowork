// apps/desktop/tests/e2e/purser-config.spec.ts
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';

const livePurserKey = process.env.PURSER_COWORK_E2E_KEY;

test('settings: configure Purser gateway without exposing the key in Cowork state', async () => {
  test.skip(!livePurserKey, 'requires PURSER_COWORK_E2E_KEY for the live Purser configuration exercise');
  test.setTimeout(60_000);
  const work = path.join('/tmp', `purser-config-e2e-${Date.now()}`);
  const userData = path.join(work, '.userdata');
  mkdirSync(work, { recursive: true });
  const env = { ...process.env, HERMES_COWORK_USERDATA: userData, NODE_ENV: 'test' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.join(__dirname, '../../out/main/index.js')], env });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await expect(win.locator('body')).toContainText(/Chat|Cowork/, { timeout: 20_000 });
    await win.getByRole('link', { name: 'Cowork' }).click();
    await win.getByRole('link', { name: /Settings/i }).click();
    await expect(win.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await win.getByPlaceholder('http://127.0.0.1:8000').fill('http://127.0.0.1:8000');
    await win.getByPlaceholder('Hermes profile').fill('anikke');
    await win.getByPlaceholder('Purser model id').fill('qwen/qwen3-coder');
    await win.getByPlaceholder('Purser inference API key').fill(livePurserKey!);
    await win.getByRole('button', { name: 'Configure Purser gateway' }).click();
    await expect(win.getByText(/configured for at least one profile/i)).toBeVisible({ timeout: 20_000 });
    const settings = readFileSync(path.join(userData, 'settings.json'), 'utf8');
    expect(settings).not.toContain(livePurserKey!);
    const profileEnv = readFileSync(path.join(homedir(), '.hermes', 'profiles', 'anikke', '.env'), 'utf8');
    expect(profileEnv).toContain('PURSER_COWORK_API_KEY=');
    expect(existsSync(path.join(userData, 'settings.json'))).toBe(true);
  } finally {
    await app.close();
    rmSync(work, { recursive: true, force: true });
  }
});
