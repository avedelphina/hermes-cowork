// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextStore } from '@main/store/context-store';

let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'context-')), 'contexts.json');
});

describe('ContextStore', () => {
  it('creates a durable context with an optional funding reference', () => {
    const store = new ContextStore(file);
    const context = store.create({ name: 'Acme integration', fundingRef: 'wallet-acme' });

    expect(context.fundingRef).toBe('wallet-acme');
    expect(context.archived).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8')).contexts[0].id).toBe(context.id);
  });

  it('normalizes legacy and corrupt data safely', () => {
    writeFileSync(file, JSON.stringify({ contexts: [{ id: 'c1', name: 'Old', createdAt: 't', updatedAt: 't' }] }));
    expect(new ContextStore(file).get('c1')).toMatchObject({ fundingRef: null, archived: false });

    writeFileSync(file, '{not json');
    expect(new ContextStore(file).snapshot()).toEqual({ contexts: [] });
  });

  it('archives without removing the durable reference', () => {
    const store = new ContextStore(file);
    const context = store.create({ name: 'Acme' });
    expect(store.archive(context.id)).toMatchObject({ id: context.id, archived: true });
    expect(new ContextStore(file).get(context.id)?.archived).toBe(true);
  });
});
