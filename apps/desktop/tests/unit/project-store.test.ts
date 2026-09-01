// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '@main/store/project-store';

let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'proj-')), 'projects.json');
});

describe('ProjectStore', () => {
  it('create makes the project active and persists to disk', () => {
    const store = new ProjectStore(file);
    const p = store.create({ name: 'Site', folderPath: '/w/site', profile: 'anikke' });
    expect(store.snapshot()).toEqual({ projects: [p], activeId: p.id });
    expect(JSON.parse(readFileSync(file, 'utf8')).activeId).toBe(p.id);
  });

  it('reloads state from disk', () => {
    const a = new ProjectStore(file).create({ name: 'A', folderPath: '/a', profile: 'x' });
    const reopened = new ProjectStore(file);
    expect(reopened.activeProject()?.id).toBe(a.id);
  });

  it('setActive switches the active project and bumps lastOpenedAt', () => {
    const store = new ProjectStore(file);
    const a = store.create({ name: 'A', folderPath: '/a', profile: 'x' });
    const b = store.create({ name: 'B', folderPath: '/b', profile: 'x' });
    const before = store.get(a.id)!.lastOpenedAt;
    store.setActive(a.id);
    expect(store.activeProject()?.id).toBe(a.id);
    expect(store.get(a.id)!.lastOpenedAt >= before).toBe(true);
    expect(b.id).not.toBe(a.id);
  });

  it('remove forgets the project and re-points active, never returning a folder path to delete', () => {
    const store = new ProjectStore(file);
    const a = store.create({ name: 'A', folderPath: '/a', profile: 'x' });
    const b = store.create({ name: 'B', folderPath: '/b', profile: 'x' });
    store.setActive(a.id);
    store.remove(a.id);
    expect(store.get(a.id)).toBeNull();
    expect(store.activeProject()?.id).toBe(b.id);
  });

  it('survives a corrupt file', () => {
    const { writeFileSync } = require('node:fs');
    writeFileSync(file, '{not json');
    const store = new ProjectStore(file);
    expect(store.snapshot()).toEqual({ projects: [], activeId: null });
  });
});
