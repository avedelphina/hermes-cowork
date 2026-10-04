// apps/desktop/src/main/store/context-pin-store.ts
//
// What the user approved as a project's instructions (see security/context-pin).
// Separate from projects.json: it holds file contents, and the renderer gets
// the project list over IPC. Keyed by project id; never writable from the renderer.

import { readJson, writeJsonAtomic } from './json-file';
import type { ContextPins } from '../security/context-pin';

export class ContextPinStore {
  private data: Record<string, ContextPins>;

  constructor(private readonly filePath: string) {
    const raw = readJson(filePath);
    this.data = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, ContextPins>) : {};
  }

  get(projectId: string): ContextPins {
    return this.data[projectId] ?? {};
  }

  set(projectId: string, pins: ContextPins): void {
    this.data[projectId] = pins;
    writeJsonAtomic(this.filePath, this.data);
  }

  remove(projectId: string): void {
    if (!(projectId in this.data)) return;
    delete this.data[projectId];
    writeJsonAtomic(this.filePath, this.data);
  }
}
