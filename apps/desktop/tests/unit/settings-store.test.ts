// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from '@main/store/settings-store';

let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'settings-')), 'settings.json');
});

describe('SettingsStore', () => {
  it('defaults to untracked chats and no funding reference', () => {
    expect(new SettingsStore(file).snapshot()).toEqual({ defaultFundingRef: null, trackChatsByDefault: false, midTurnSend: 'steer' });
  });

  it('persists an optional funding reference and explicit chat opt-in', () => {
    const store = new SettingsStore(file);
    store.update({ defaultFundingRef: ' wallet-1 ', trackChatsByDefault: true, midTurnSend: 'steer' });
    expect(new SettingsStore(file).snapshot()).toEqual({ defaultFundingRef: 'wallet-1', trackChatsByDefault: true, midTurnSend: 'steer' });
  });

  it('normalizes legacy and corrupt records safely', () => {
    writeFileSync(file, JSON.stringify({ defaultFundingRef: 'old' }));
    expect(new SettingsStore(file).snapshot()).toEqual({ defaultFundingRef: 'old', trackChatsByDefault: false, midTurnSend: 'steer' });
    writeFileSync(file, '{broken');
    expect(new SettingsStore(file).snapshot()).toEqual({ defaultFundingRef: null, trackChatsByDefault: false, midTurnSend: 'steer' });
  });
});
