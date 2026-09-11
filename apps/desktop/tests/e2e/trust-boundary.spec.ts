// apps/desktop/tests/e2e/trust-boundary.spec.ts
//
// The renderer→main boundary against a foreign document. Layer 1: the
// renderer cannot navigate the window away from the app. Layer 2: even if a
// foreign page is loaded (here forced from main, which bypasses will-navigate)
// and inherits the preload bridge, every privileged IPC call is refused.
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';

test('foreign documents never get privileged IPC', async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.HERMES_COWORK_USERDATA = path.join('/tmp', 'trust-boundary-test', '.userdata');
  const app = await electron.launch({ args: [path.join(__dirname, '../../out/main/index.js')], env });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('body')).toContainText(/Chat|Cowork/, { timeout: 20_000 });
  const doc = () => win.url().split('#')[0]!;
  const appUrl = doc();

  // The app itself is served.
  await expect.poll(() => win.evaluate(() => window.hermes.projects.list().then(() => 'ok'))).toBe('ok');

  // Layer 1 — a lookalike of the app URL and a plain foreign URL are both blocked.
  for (const target of [`${appUrl}.attacker.example/`, 'https://example.com/']) {
    await win.evaluate((t) => { location.href = t; }, target);
    await win.waitForTimeout(500);
    expect(doc()).toBe(appUrl);
  }

  // Layer 2 — force a foreign document in from main; the bridge is present
  // but every channel refuses it.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.webContents.loadURL('data:text/html,<p>foreign</p>'));
  await expect.poll(() => win.url()).toContain('data:text/html');
  const results = await win.evaluate(async () => {
    const h = window.hermes;
    const calls: Array<[string, () => Promise<unknown>]> = [
      ['projects.list', () => h.projects.list()],
      ['rest.get', () => h.rest.get('/api/status')],
      ['acp.start', () => h.acp.start({ profile: 'default' })],
      ['fs.read', () => h.fs.read('x', 'y')],
    ];
    return Promise.all(calls.map(([name, fn]) => fn().then(() => `${name}: SERVED`, (e) => `${name}: ${String(e)}`)));
  });
  for (const r of results) expect(r).toMatch(/refused: untrusted sender/);

  await app.close();
});
