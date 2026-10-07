import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';

test('settings saves local tracking without changing the Hermes provider', async () => {
  test.setTimeout(60_000);
  const work = path.join('/tmp', `settings-tracking-${Date.now()}`);
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
    await expect(win.getByText('Purser gateway')).toHaveCount(0);
    await win.getByPlaceholder('wallet or funding reference').fill(' wallet-1 ');
    await win.getByRole('checkbox', { name: /Track new chats by default/i }).check();
    await win.getByRole('button', { name: 'Save settings' }).click();
    await expect(win.getByText('Saved')).toBeVisible();
    expect(JSON.parse(readFileSync(path.join(userData, 'settings.json'), 'utf8'))).toEqual({
      defaultFundingRef: 'wallet-1',
      trackChatsByDefault: true,
      midTurnSend: 'steer',
    });
  } finally {
    await app.close();
    rmSync(work, { recursive: true, force: true });
  }
});
