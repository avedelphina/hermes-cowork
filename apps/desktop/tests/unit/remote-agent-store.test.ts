// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RemoteAgentStore, toOrigin } from '@main/store/remote-agent-store';

let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'remotes-')), 'remote-agents.json');
});

const input = { name: 'Ocean', sshTarget: 'root@ocean', hermesHome: null, binaryPath: null, profile: 'default' };

describe('RemoteAgentStore', () => {
  it('starts empty and persists what it creates', () => {
    expect(new RemoteAgentStore(file).list()).toEqual([]);
    const a = new RemoteAgentStore(file).create(input);
    expect(a).toMatchObject({ name: 'Ocean', sshTarget: 'root@ocean', profile: 'default' });
    expect(new RemoteAgentStore(file).get(a.id)?.name).toBe('Ocean');
  });

  it('update changes only the allowed fields', () => {
    const store = new RemoteAgentStore(file);
    const a = store.create(input);
    const u = store.update(a.id, { name: 'Ocean 2', id: 'evil', createdAt: 'x' } as never);
    expect(u).toMatchObject({ name: 'Ocean 2', id: a.id, createdAt: a.createdAt });
    expect(store.update('nope', { name: 'x' })).toBeNull();
  });

  it('remove deletes it', () => {
    const store = new RemoteAgentStore(file);
    const a = store.create(input);
    store.remove(a.id);
    expect(new RemoteAgentStore(file).list()).toEqual([]);
  });

  it('toOrigin keeps only the connection fields', () => {
    const a = new RemoteAgentStore(file).create({ ...input, hermesHome: '/srv/h', binaryPath: '/opt/hermes' });
    expect(toOrigin(a)).toEqual({ sshTarget: 'root@ocean', hermesHome: '/srv/h', binaryPath: '/opt/hermes' });
  });
});
