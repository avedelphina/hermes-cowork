// apps/desktop/src/main/store/json-file.ts
//
// Crash-safe JSON persistence shared by the stores.

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';

/** Parsed file contents, `null` if missing. A corrupt file is moved aside
 * (`<file>.corrupt-<ts>`) so the next write cannot silently destroy it. */
export function readJson(filePath: string): unknown {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    try { renameSync(filePath, `${filePath}.corrupt-${Date.now()}`); } catch { /* ignore */ }
    return null;
  }
}

/** Write via temp file + rename so a crash mid-write never truncates the file. */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, filePath);
}

/** Copy only `keys` from an untrusted patch (IPC input) — no mass assignment. */
export function pick<T extends object, K extends keyof T>(patch: Partial<T>, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (patch && Object.hasOwn(patch, k)) out[k] = patch[k];
  return out;
}
