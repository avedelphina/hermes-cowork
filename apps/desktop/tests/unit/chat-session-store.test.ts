// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatSessionStore } from '@main/store/chat-session-store';

let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'chat-')), 'chats.json');
});

const input = { acpSessionId: 's1', projectId: null, title: null };

describe('ChatSessionStore', () => {
  it('create persists a chat another instance can read', () => {
    const store = new ChatSessionStore(file);
    const c = store.create(input);
    expect(c).toMatchObject({ acpSessionId: 's1', title: null, projectId: null });
    expect(new ChatSessionStore(file).get(c.id)?.acpSessionId).toBe('s1');
  });

  it('update sets the title and bumps updatedAt', async () => {
    const store = new ChatSessionStore(file);
    const c = store.create(input);
    const u = store.update(c.id, { title: 'Hello there' });
    expect(u).toMatchObject({ title: 'Hello there' });
    expect(u!.updatedAt >= c.updatedAt).toBe(true);
  });

  it('list is most-recent first', async () => {
    const store = new ChatSessionStore(file);
    const a = store.create({ ...input, acpSessionId: 'a' });
    await new Promise((r) => setTimeout(r, 5));
    const b = store.create({ ...input, acpSessionId: 'b' });
    expect(store.list().map((c) => c.id)).toEqual([b.id, a.id]);
  });

  it('remove forgets the chat', () => {
    const store = new ChatSessionStore(file);
    const c = store.create(input);
    store.remove(c.id);
    expect(new ChatSessionStore(file).get(c.id)).toBeNull();
  });

  it('survives a corrupt file', () => {
    writeFileSync(file, 'not json');
    expect(new ChatSessionStore(file).list()).toEqual([]);
  });
});
