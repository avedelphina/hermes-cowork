// apps/desktop/src/main/store/project-store.ts
//
// Persistent list of projects — a project is a name + an optional local folder
// + the Hermes profile to run it as. A folderless project is chat-only (Cowork
// tasks require a folder). Stored as plain JSON under userData (no
// electron-store: it is ESM-only and the main bundle is CJS). Removing a
// project never touches its folder.

import { readJson, writeJsonAtomic, pick } from './json-file';
import { randomUUID } from 'node:crypto';

import type { Project } from '../../shared/types';
export type { Project };

type Data = { projects: Project[]; activeId: string | null };
type CreateInput = { name: string; folderPath: string | null; profile: string };
type UpdatePatch = Partial<Pick<Project, 'name' | 'profile' | 'folderPath' | 'archived'>>;

export class ProjectStore {
  private data: Data = { projects: [], activeId: null };

  /** `filePath` is injected so tests can point at a temp file. */
  constructor(private readonly filePath: string) {
    this.data = this.read();
  }

  private read(): Data {
    const parsed = (readJson(this.filePath) ?? {}) as Partial<Data>;
    const projects = (Array.isArray(parsed.projects) ? parsed.projects : []).map((p) => ({
      ...p,
      archived: p.archived ?? false, // migrate pre-archive records
    }));
    return {
      projects,
      activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null,
    };
  }

  private write(): void {
    writeJsonAtomic(this.filePath, this.data);
  }

  snapshot(): Data {
    return { projects: [...this.data.projects], activeId: this.data.activeId };
  }

  get(id: string): Project | null {
    return this.data.projects.find((p) => p.id === id) ?? null;
  }

  activeProject(): Project | null {
    return this.data.activeId ? this.get(this.data.activeId) : null;
  }

  create(input: CreateInput): Project {
    const now = new Date().toISOString();
    const project: Project = {
      name: input.name, folderPath: input.folderPath, profile: input.profile,
      id: randomUUID(), createdAt: now, lastOpenedAt: now, archived: false,
    };
    this.data.projects.push(project);
    this.data.activeId = project.id;
    this.write();
    return project;
  }

  update(id: string, patch: UpdatePatch): Project | null {
    const project = this.get(id);
    if (!project) return null;
    Object.assign(project, pick(patch, ['name', 'profile', 'folderPath', 'archived'] as const));
    // Archiving the active project drops the active pointer to the next live one.
    if (project.archived && this.data.activeId === id) {
      this.data.activeId = this.data.projects.find((p) => !p.archived)?.id ?? null;
    }
    this.write();
    return project;
  }

  setActive(id: string): void {
    const project = this.get(id);
    if (!project) return;
    project.lastOpenedAt = new Date().toISOString();
    project.archived = false; // opening a project un-archives it
    this.data.activeId = id;
    this.write();
  }

  /** Forget a project. The folder on disk is left untouched. */
  remove(id: string): void {
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    if (this.data.activeId === id) {
      this.data.activeId = this.data.projects[0]?.id ?? null;
    }
    this.write();
  }
}
