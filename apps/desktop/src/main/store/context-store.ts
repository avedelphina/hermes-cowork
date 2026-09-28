// Persistent grouping for related projects. Contexts carry no project ids: project
// membership is stored by each Project so records stay consistent on reload.
import { randomUUID } from 'node:crypto';
import { readJson, writeJsonAtomic, pick } from './json-file';

import type { Context, ContextSnapshot } from '../../shared/types';
export type { Context };

type Data = ContextSnapshot;
type CreateInput = { name: string; fundingRef?: string | null };
type UpdatePatch = Partial<Pick<Context, 'name' | 'fundingRef' | 'archived'>>;

export class ContextStore {
  private data: Data = { contexts: [] };

  constructor(private readonly filePath: string) {
    this.data = this.read();
  }

  private read(): Data {
    const parsed = (readJson(this.filePath) ?? {}) as Partial<Data>;
    return {
      contexts: (Array.isArray(parsed.contexts) ? parsed.contexts : []).map((context) => ({
        ...context,
        fundingRef: typeof context.fundingRef === 'string' ? context.fundingRef : null,
        archived: context.archived ?? false,
      })),
    };
  }

  private write(): void {
    writeJsonAtomic(this.filePath, this.data);
  }

  snapshot(): ContextSnapshot {
    return { contexts: [...this.data.contexts] };
  }

  get(id: string): Context | null {
    return this.data.contexts.find((context) => context.id === id) ?? null;
  }

  create(input: CreateInput): Context {
    const now = new Date().toISOString();
    const context: Context = {
      id: randomUUID(),
      name: input.name,
      fundingRef: input.fundingRef?.trim() || null,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    this.data.contexts.push(context);
    this.write();
    return context;
  }

  update(id: string, patch: UpdatePatch): Context | null {
    const context = this.get(id);
    if (!context) return null;
    Object.assign(context, pick(patch, ['name', 'fundingRef', 'archived'] as const));
    context.updatedAt = new Date().toISOString();
    this.write();
    return context;
  }

  /** Archive is preferred so existing project/task attribution remains legible. */
  archive(id: string): Context | null {
    return this.update(id, { archived: true });
  }
}
