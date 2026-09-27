// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore } from '@main/store/task-store';

let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'task-')), 'tasks.json');
});

const input = { title: 'Task name', cwd: '/w', profile: 'p', projectId: null };

describe('TaskStore', () => {
  it('create starts a named task as a draft and persists it', () => {
    const store = new TaskStore(file);
    const t = store.create(input);
    expect(t).toMatchObject({ status: 'draft', approved: false, title: 'Task name', acpSessionId: null });
    expect(new TaskStore(file).get(t.id)?.title).toBe('Task name');
  });

  it('start binds an ACP session exactly once', () => {
    const store = new TaskStore(file);
    const t = store.create(input);
    expect(store.start(t.id, 's1')).toMatchObject({ status: 'planning', acpSessionId: 's1' });
    expect(store.start(t.id, 's2')).toBeNull();
  });

  it('update bumps updatedAt and changes status', () => {
    const store = new TaskStore(file);
    const t = store.create(input);
    const before = store.get(t.id)!.updatedAt;
    const u = store.update(t.id, { status: 'executing', approved: true });
    expect(u).toMatchObject({ status: 'executing', approved: true });
    expect(u!.updatedAt >= before).toBe(true);
  });

  it('uses explicit core gate commands instead of a generic lifecycle patch', () => {
    const store = new TaskStore(file);
    const task = store.create(input);
    store.start(task.id, 's1');
    expect(store.approveDesign(task.id)).toMatchObject({ designApproved: true, status: 'executing' });
    expect(store.rearmForPlan(task.id)).toMatchObject({ approved: false, status: 'awaiting_approval' });
    expect(store.approveDesign(task.id)).toMatchObject({ designApproved: true });
    expect(store.approveVerification(task.id)).toMatchObject({ implementationApproved: true, verificationApproved: true });
    expect(store.complete(task.id)).toMatchObject({ status: 'done' });
    expect(store.rearmForPlan(task.id)).toBeNull();
  });
  it('list is most-recent first', async () => {
    const store = new TaskStore(file);
    const a = store.create({ ...input, title: 'a' });
    await new Promise((r) => setTimeout(r, 5));
    const b = store.create({ ...input, title: 'b' });
    expect(store.list().map((t) => t.id)).toEqual([b.id, a.id]);
  });

  it('marks a live task as interrupted when reloaded (app died mid-task)', () => {
    const store = new TaskStore(file);
    const t = store.create(input);
    store.start(t.id, 's1');
    store.update(t.id, { status: 'executing' });
    expect(new TaskStore(file).get(t.id)?.status).toBe('interrupted');
  });

  it('keeps a live task attachable across a desktop restart when it has a durable run', () => {
    const first = new TaskStore(file);
    const task = first.create(input);
    const run = first.createRun(task.id, null)!;
    first.start(task.id, 's1');
    first.bindRunSession(run.id, 's1');
    first.attachRun(run.id);
    first.update(task.id, { status: 'executing' });

    const second = new TaskStore(file);
    expect(second.get(task.id)).toMatchObject({ status: 'executing', acpSessionId: 's1' });
    expect(second.activeRun(task.id)).toMatchObject({ id: run.id, status: 'attached', acpSessionId: 's1' });
  });
  it('leaves finished tasks alone on reload', () => {
    const store = new TaskStore(file);
    const t = store.create(input);
    store.start(t.id, 's1');
    store.update(t.id, { status: 'done' });
    expect(new TaskStore(file).get(t.id)?.status).toBe('done');
  });

  it('migrates legacy task names', () => {
    writeFileSync(file, JSON.stringify({ tasks: [{ id: 'old', goal: 'Legacy task', cwd: '/w', profile: 'p', acpSessionId: 's', projectId: null, status: 'done', approved: false, createdAt: 'a', updatedAt: 'a' }] }));
    expect(new TaskStore(file).get('old')).toMatchObject({ title: 'Legacy task', acpSessionId: 's' });
  });

  it('survives a corrupt file', () => {
    writeFileSync(file, 'not json');
    expect(new TaskStore(file).list()).toEqual([]);
  });

  it('moves a corrupt file aside instead of letting the next write destroy it', () => {
    writeFileSync(file, '{ not json');
    new TaskStore(file).create(input);
    expect(readdirSync(dirname(file)).some((f) => f.startsWith('tasks.json.corrupt-'))).toBe(true);
  });

  it('ignores fields outside the whitelist on create and update (no mass assignment)', () => {
    const store = new TaskStore(file);
    const t = store.create(input);
    expect(t.id).not.toBe('forged');
    expect(t.approved).toBe(false);
    store.update(t.id, { status: 'done', cwd: '/' } as never);
    expect(store.get(t.id)).toMatchObject({ status: 'done', cwd: '/w' });
  });
});
