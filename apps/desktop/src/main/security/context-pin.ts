// apps/desktop/src/main/security/context-pin.ts
//
// Project instruction files are untrusted input: Hermes loads AGENTS.md,
// .hermes.md & co. from the task folder into the agent's system prompt, so
// whoever can change one steers the agent — a teammate's commit, a pulled
// branch, a cloned stranger's repo, or the agent itself persisting a prompt
// for the next run. We pin what the user approved and ask again on any change.
//
// Which files Hermes loads (docs/user-guide/features/context-files.md, 0.21.3):
//   root:   first match of .hermes.md/HERMES.md → AGENTS.override.md → AGENTS.md
//           → CLAUDE.md → .cursorrules (+ .cursor/rules/*.mdc)
//   nested: AGENTS.override.md / AGENTS.md / CLAUDE.md / .cursorrules, loaded
//           when the agent touches that folder
// We pin every candidate, not just the winner: a new higher-priority file
// changes what loads, and that must be noticed too.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { lineDiff } from '../../shared/diff';
import type { ContextEntry } from '../../shared/types';

const ROOT_NAMES = ['.hermes.md', 'HERMES.md', 'AGENTS.override.md', 'AGENTS.md', 'CLAUDE.md', '.cursorrules'];
const NESTED_NAMES = new Set(['AGENTS.override.md', 'AGENTS.md', 'CLAUDE.md', '.cursorrules']);
const SKIP_DIRS = new Set(['node_modules', '.git']);
const MAX_BYTES = 1 << 20;
// ponytail: bounded walk, not git-aware. A repo with >5000 folders or files nested
// deeper than 6 levels is not fully scanned; use `git ls-files` if that bites.
const MAX_DEPTH = 6;
const MAX_DIRS = 5000;

export type ContextFile = { path: string; sha256: string; text: string };
/** What was approved: content is kept so a later change can be shown as a diff. */
export type ContextPins = Record<string, { sha256: string; text: string }>;
export type ContextChange =
  | { kind: 'new'; path: string; after: string }
  | { kind: 'changed'; path: string; before: string; after: string }
  | { kind: 'removed'; path: string; before: string };

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

function readText(abs: string): string | null {
  try {
    if (!statSync(abs).isFile()) return null; // follows symlinks: the target's content is what Hermes would read
    return readFileSync(abs).subarray(0, MAX_BYTES).toString('utf8');
  } catch {
    return null;
  }
}

/** Every instruction file under `root` that Hermes could load, sorted by path. */
export function scanContext(root: string): ContextFile[] {
  const out: ContextFile[] = [];
  const add = (abs: string): void => {
    const text = readText(abs);
    if (text !== null) out.push({ path: relative(root, abs).split(sep).join('/'), sha256: sha(text), text });
  };
  for (const n of ROOT_NAMES) add(join(root, n));
  try {
    for (const e of readdirSync(join(root, '.cursor', 'rules'))) if (e.endsWith('.mdc')) add(join(root, '.cursor', 'rules', e));
  } catch { /* none */ }

  let dirs = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH || ++dirs > MAX_DIRS) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(join(dir, e.name), depth + 1); // symlinked dirs are not followed
      else if (depth > 0 && NESTED_NAMES.has(e.name) && !e.isDirectory()) add(join(dir, e.name));
    }
  };
  walk(root, 0);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export const pinsOf = (files: ContextFile[]): ContextPins =>
  Object.fromEntries(files.map((f) => [f.path, { sha256: f.sha256, text: f.text }]));

/** Differences between what was approved and what is on disk now. Empty = nothing to ask. */
export function diffContext(pins: ContextPins, files: ContextFile[]): ContextChange[] {
  const changes: ContextChange[] = [];
  const now = new Map(files.map((f) => [f.path, f]));
  for (const f of files) {
    const pin = pins[f.path];
    if (!pin) changes.push({ kind: 'new', path: f.path, after: f.text });
    else if (pin.sha256 !== f.sha256) changes.push({ kind: 'changed', path: f.path, before: pin.text, after: f.text });
  }
  for (const [path, pin] of Object.entries(pins)) {
    if (!now.has(path)) changes.push({ kind: 'removed', path, before: pin.text });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

/** Who last committed a file, e.g. "Ana, 3 days ago", "uncommitted changes", or null outside git. */
export function lastChange(root: string, path: string): string | null {
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    if (git(['status', '--porcelain', '--', path])) return 'uncommitted changes';
    return git(['log', '-1', '--format=%an, %ar', '--', path]) || null;
  } catch {
    return null;
  }
}

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s);

/** Plain text for the approval dialog: what changed, with the added lines that matter. */
export function describeChanges(root: string, changes: ContextChange[], maxPerFile = 700, maxTotal = 3500): string {
  const parts = changes.map((c) => {
    const who = c.kind === 'removed' ? null : lastChange(root, c.path);
    const head = `${c.kind.toUpperCase()}  ${c.path}${who ? `  (${who})` : ''}`;
    if (c.kind === 'removed') return head;
    if (c.kind === 'new') return `${head}\n${clip(c.after.trim(), maxPerFile)}`;
    const rows = lineDiff(c.before, c.after).rows.filter((r) => r.type !== ' ').map((r) => `${r.type} ${r.text}`);
    return `${head}\n${clip(rows.join('\n'), maxPerFile)}`;
  });
  return clip(parts.join('\n\n'), maxTotal);
}

/** For the Projects page: every instruction file Hermes could load, and whether it matches what was approved. */
export function contextEntries(root: string, pins: ContextPins): ContextEntry[] {
  const files = scanContext(root);
  const kinds = new Map(diffContext(pins, files).map((c) => [c.path, c.kind] as const));
  const live: ContextEntry[] = files.map((f) => ({
    path: f.path, status: kinds.get(f.path) ?? 'approved', lastChange: lastChange(root, f.path), bytes: Buffer.byteLength(f.text),
  }));
  const gone: ContextEntry[] = [...kinds].filter(([, k]) => k === 'removed')
    .map(([path]) => ({ path, status: 'removed' as const, lastChange: null, bytes: 0 }));
  return [...live, ...gone];
}
