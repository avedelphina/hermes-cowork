// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore } from '@main/store/task-store';

let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'task-')), 'tasks.json');
});

const input = { goal: 'g', cwd: '/w', profile: 'p', acpSessionId: 's1', projectId: null };

describe('TaskStore', () => {
  it('create starts a task in planning and persists it', () => {
    const store = new TaskStore(file);
    const t = store.create(input);
    expect(t).toMatchObject({ status: 'planning', approved: false, goal: 'g', acpSessionId: 's1' });
    // A separate instance sees the persisted task (its live status becomes
    // 'interrupted' on reload — covered by its own test).
    expect(new TaskStore(file).get(t.id)?.goal).toBe('g');
  });

  it('update bumps updatedAt and changes status', () => {
    const store = new TaskStore(file);
    const t = store.create(input);
    const before = store.get(t.id)!.updatedAt;
    const u = store.update(t.id, { status: 'executing', approved: true });
    expect(u).toMatchObject({ status: 'executing', approved: true });
    expect(u!.updatedAt >= before).toBe(true);
  });

  it('list is most-recent first', async () => {
    const store = new TaskStore(file);
    const a = store.create({ ...input, goal: 'a' });
    await new Promise((r) => setTimeout(r, 5));
    const b = store.create({ ...input, goal: 'b' });
    expect(store.list().map((t) => t.id)).toEqual([b.id, a.id]);
  });

  it('marks a live task as interrupted when reloaded (app died mid-task)', () => {
    const store = new TaskStore(file);
    const t = store.create(input);
    store.update(t.id, { status: 'executing' });
    expect(new TaskStore(file).get(t.id)?.status).toBe('interrupted');
  });

  it('leaves finished tasks alone on reload', () => {
    const store = new TaskStore(file);
    const t = store.create(input);
    store.update(t.id, { status: 'done' });
    expect(new TaskStore(file).get(t.id)?.status).toBe('done');
  });

  it('survives a corrupt file', () => {
    writeFileSync(file, 'not json');
    expect(new TaskStore(file).list()).toEqual([]);
  });
});
