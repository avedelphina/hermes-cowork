// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAppUrl } from '@main/security/app-url';

const dev = { devUrl: 'http://localhost:5173', indexHtml: '/unused' };
const prod = { devUrl: undefined, indexHtml: '/Applications/Hermes Cowork.app/Contents/Resources/app/out/renderer/index.html' };

describe('isAppUrl — dev', () => {
  it('accepts the dev origin, any route/hash', () => {
    expect(isAppUrl('http://localhost:5173/', dev)).toBe(true);
    expect(isAppUrl('http://localhost:5173/#/cowork', dev)).toBe(true);
  });

  it('rejects lookalike and foreign origins', () => {
    for (const url of [
      'http://localhost:5173.attacker.example/',
      'http://localhost:5173@attacker.example/',
      'http://localhost:51730/',
      'https://localhost:5173/',
      'http://127.0.0.1:5173/',
      'file:///etc/passwd',
      'not a url',
    ]) expect(isAppUrl(url, dev), url).toBe(false);
  });
});

describe('isAppUrl — packaged', () => {
  it('accepts exactly index.html (hash routes included)', () => {
    expect(isAppUrl('file:///Applications/Hermes%20Cowork.app/Contents/Resources/app/out/renderer/index.html', prod)).toBe(true);
    expect(isAppUrl('file:///Applications/Hermes%20Cowork.app/Contents/Resources/app/out/renderer/index.html#/chat', prod)).toBe(true);
  });

  it('rejects other files, pushState-style paths and remote pages', () => {
    for (const url of [
      'file:///cowork',
      'file:///tmp/evil.html',
      'file:///Applications/Hermes%20Cowork.app/Contents/Resources/app/out/renderer/index.html.evil',
      'file://attacker.example/Applications/Hermes%20Cowork.app/Contents/Resources/app/out/renderer/index.html',
      'https://attacker.example/index.html',
    ]) expect(isAppUrl(url, prod), url).toBe(false);
  });
});

describe('IPC registration', () => {
  it('every handler goes through the sender-checking wrapper', () => {
    const src = readFileSync(join(__dirname, '../../src/main/ipc/handlers.ts'), 'utf8');
    // Exactly one raw registration: the one inside the wrapper itself.
    expect(src.match(/ipcMain\.(handle|on|once|handleOnce)\(/g)).toEqual(['ipcMain.handle(']);
  });
});
