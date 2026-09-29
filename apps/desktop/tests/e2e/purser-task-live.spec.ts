import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

const livePurserKey = process.env.PURSER_COWORK_E2E_KEY;
const livePurserEndpoint = process.env.PURSER_COWORK_E2E_ENDPOINT ?? 'https://credits.ocean';
const liveFundingRef = process.env.PURSER_COWORK_E2E_FUNDING_REF;

if (!liveFundingRef) {
  throw new Error('PURSER_COWORK_E2E_FUNDING_REF is required');
}

test('Cowork task uses the configured Purser-backed model', async () => {
  const key = livePurserKey;
  test.skip(!key, 'requires PURSER_COWORK_E2E_KEY');
  test.setTimeout(240_000);

  const work = path.join('/tmp', `purser-cowork-task-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const userData = path.join(work, '.userdata');
  const env = { ...process.env, HERMES_COWORK_USERDATA: userData, COWORK_PIPE_DIR: path.join(work, 'runs'), NODE_ENV: 'test' };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({ args: [path.join(__dirname, '../../out/main/index.js')], env });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await expect(win.locator('body')).toContainText(/Chat|Cowork/, { timeout: 20_000 });
    await win.getByRole('link', { name: 'Cowork' }).click();
    await win.getByRole('link', { name: /Settings/i }).click();
    await win.getByPlaceholder('http://127.0.0.1:8000').fill(livePurserEndpoint);
    await win.getByPlaceholder('Hermes profile').fill('anikke');
    await win.getByPlaceholder('Purser model id').fill('qwen/qwen3-coder');
    await win.getByPlaceholder('Purser inference API key').fill(key!);
    await win.getByRole('button', { name: 'Configure Purser gateway' }).click();
    await expect(win.getByText(/configured for at least one profile/i)).toBeVisible({ timeout: 20_000 });
    await win.getByRole('link', { name: 'Projects' }).click();
    await expect(win.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible({ timeout: 20_000 });
    await win.getByRole('button', { name: /New project/i }).click();
    await win.getByPlaceholder('Site redesign').fill('Purser attribution project');
    await win.locator('input[placeholder="/Users/x/work/site"]').fill(work);
    await win.getByPlaceholder('wallet or funding reference').fill(liveFundingRef!);
    await win.getByRole('button', { name: 'Create project' }).click();
    await expect(win.getByText('Purser attribution project', { exact: true })).toBeVisible({ timeout: 20_000 });
    await win.getByRole('link', { name: 'Projects' }).click();
    await expect(win.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible({ timeout: 20_000 });
    const project = win.getByRole('listitem').filter({ hasText: 'Purser attribution project' });
    await expect(project).toBeVisible({ timeout: 20_000 });
    await win.getByRole('link', { name: 'Cowork' }).click();
    await win.getByRole('link', { name: 'New task' }).click();
    await win.getByPlaceholder('e.g. Redesign the macOS app').fill('Purser live accounting check');
    await win.getByPlaceholder('/Users/x/work/q2-report').fill(work);
    await win.getByText('Profile', { exact: true }).locator('..').getByRole('combobox').selectOption('anikke');
    await win.locator('input[type="checkbox"]').uncheck();
    await win.getByRole('button', { name: /Create task/i }).click();

    const composer = win.getByRole('textbox', { name: 'Message input' });
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill('Reply with exactly PURSER_E2E_OK and do not use tools.');
    const sendKey = win.getByRole('button', { name: 'Toggle send key' });
    if ((await sendKey.textContent())?.includes('⌥') || (await sendKey.textContent())?.includes('Send: ⌘')) {
      await sendKey.click();
    }
    await composer.focus();
    await composer.press('Enter');
    await expect.poll(async () => (await win.locator('body').textContent()) ?? '', { timeout: 120_000 }).toContain('PURSER_E2E_OK');

    const activeModel = await win.locator('body').textContent();
    console.log(`live ACP surface after response: ${activeModel?.slice(-1000) ?? ''}`);
    expect(activeModel).toContain('PURSER_E2E_OK');
  } finally {
    await app.close();
    rmSync(work, { recursive: true, force: true });
  }
});
