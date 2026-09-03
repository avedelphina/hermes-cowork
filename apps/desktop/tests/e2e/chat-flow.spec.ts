// apps/desktop/tests/e2e/chat-flow.spec.ts
// Drives the Chat mode end to end against a REAL Hermes + live model: send a
// message, get a reply, confirm the chat persists in the SessionList and
// resumes (session/load replay) after switching away and back, and across an
// app restart. Slow, requires a configured Hermes on PATH — run with
// `pnpm test:e2e`, skipped automatically when Hermes is absent.
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { existsSync as fileExists, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';

const hermesPresent = ['/.local/bin/hermes', '/opt/homebrew/bin/hermes', '/usr/local/bin/hermes']
  .some((p) => fileExists(p.startsWith('/.') ? homedir() + p : p));

test('chat: send → reply → persists → resumes', async () => {
  test.skip(!hermesPresent, 'requires a configured Hermes on PATH');
  test.setTimeout(240_000);
  const work = path.join('/tmp', 'chat-ui-test');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.HERMES_COWORK_USERDATA = path.join(work, '.userdata'); // isolate chats/projects stores

  const launch = async () => {
    const app = await electron.launch({
      args: [path.join(__dirname, '../../out/main/index.js')],
      env,
    });
    const win = await app.firstWindow();
    win.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await win.waitForLoadState('domcontentloaded');
    await expect(win.locator('body')).toContainText(/Chat|Cowork/, { timeout: 20_000 });
    return { app, win };
  };

  // ── First run: send a message, get a reply ──
  let { app, win } = await launch();
  await win.getByRole('link', { name: 'Chat' }).click();

  const composer = win.getByLabel('Message input');
  await composer.fill('Reply with exactly the word: pong');
  await composer.press('Meta+Enter');

  const transcript = win.locator('.flex-1.overflow-y-auto').last();
  await expect(transcript).toContainText(/pong/i, { timeout: 120_000 });

  // The chat now shows in the SessionList, titled from the first message.
  const chatRow = win.locator('button', { hasText: /Reply with exactly the word/i });
  await expect(chatRow).toBeVisible({ timeout: 10_000 });

  // Start a fresh chat, then switch back — history replays via session/load.
  await win.getByRole('button', { name: /New chat/i }).click();
  await expect(transcript).toContainText(/Send a message to begin/i);
  await chatRow.click();
  await expect(transcript).toContainText(/pong/i, { timeout: 60_000 });

  await app.close();

  // ── Second run: the chat survived the restart and still resumes ──
  ({ app, win } = await launch());
  await win.getByRole('link', { name: 'Chat' }).click();
  const rowAgain = win.locator('button', { hasText: /Reply with exactly the word/i });
  await expect(rowAgain).toBeVisible({ timeout: 10_000 });
  await rowAgain.click();
  await expect(win.locator('.flex-1.overflow-y-auto').last()).toContainText(/pong/i, { timeout: 60_000 });

  await app.close();
});
