// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RemoteAgentStore, toOrigin } from '@main/store/remote-agent-store';

let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'remotes-')), 'remote-agents.json');
});

const input = {
  name: 'Ocean', sshTarget: 'root@ocean', hermesHome: null, binaryPath: null, profile: 'default',
  port: null, identityFile: null, proxyJump: null, runAs: null, container: null, command: null,
};

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

  it('toOrigin keeps the connection and launch fields, not name/profile/id', () => {
    const a = new RemoteAgentStore(file).create({ ...input, hermesHome: '/srv/h', binaryPath: '/opt/hermes' });
    expect(toOrigin(a)).toEqual({
      sshTarget: 'root@ocean', hermesHome: '/srv/h', binaryPath: '/opt/hermes', port: null,
      identityFile: null, proxyJump: null, runAs: null, container: null, command: null,
    });
  });

  it('reads records from before the launch options as "not set"', () => {
    writeFileSync(file, JSON.stringify({ agents: [{ id: 'a', name: 'Old', sshTarget: 'h', profile: 'p', hermesHome: null, binaryPath: null, createdAt: 'x' }] }));
    expect(new RemoteAgentStore(file).get('a')).toMatchObject({ port: null, identityFile: null, proxyJump: null, runAs: null, container: null, command: null });
  });

  it('stores and updates the deployment options', () => {
    const store = new RemoteAgentStore(file);
    const a = store.create({ ...input, container: { runtime: 'docker', name: 'hermes-alison' }, port: 2222 });
    const u = store.update(a.id, { container: null, runAs: 'root' });
    expect(u).toMatchObject({ container: null, runAs: 'root', port: 2222 });
    expect(toOrigin(new RemoteAgentStore(file).get(a.id)!)).toMatchObject({ runAs: 'root', port: 2222 });
  });
});
