// apps/desktop/src/main/security/paths.ts
//
// Folder-scope guard. See docs/security-model.md.

import { resolve, relative, isAbsolute, sep } from 'node:path';
import { statSync } from 'node:fs';

/**
 * Resolve `candidate` and confirm it stays inside `root` (lexical check —
 * callers that must defend against symlink escape should realpath first).
 * Returns the resolved absolute path, or null if it escapes.
 */
export function resolveWithinRoot(root: string, candidate: string): string | null {
  const absRoot = resolve(root);
  const abs = isAbsolute(candidate) ? resolve(candidate) : resolve(absRoot, candidate);
  if (abs === absRoot) return abs;
  const rel = relative(absRoot, abs);
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) return null;
  return abs;
}

/** True when `p` is an absolute path to an existing directory. */
export function isExistingDir(p: string): boolean {
  try {
    return isAbsolute(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}
