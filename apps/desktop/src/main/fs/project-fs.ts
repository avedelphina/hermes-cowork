// apps/desktop/src/main/fs/project-fs.ts
//
// Filesystem access scoped to a single project root. Paths are checked with
// resolveWithinRoot, and every operation then runs pinned to a verified
// directory (inDir) on no-follow primitives — so neither `..`, a symlink, nor
// a symlink swapped in after the check can escape the root.

import {
  readdirSync, statSync, lstatSync, fstatSync, realpathSync, writeFileSync, renameSync, unlinkSync,
  openSync, readSync, closeSync, constants as fsc, type Stats,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path';
import { resolveWithinRoot } from '../security/paths';
import type { DirEntry, DirListing, FilePreview } from '../../shared/types';

export type { DirEntry, DirListing, FilePreview };

const CONTEXT_FILES = ['AGENTS.md', '.hermes.md'] as const;
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.toml', '.csv', '.tsv',
  '.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs', '.java', '.c', '.h',
  '.cpp', '.css', '.scss', '.html', '.xml', '.sh', '.env', '.gitignore', '.sql',
]);
const IMG_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
};

/**
 * Run `fn` with the process cwd pinned to directory `dirRel` under `root`.
 *
 * Node has no openat()/renameat(), so a path validated up front can be
 * swapped for a symlink before it is used (TOCTOU). Pinning cwd is the
 * equivalent: after chdir, `process.cwd()` (getcwd — the physical path of the
 * directory actually entered) is checked against the real root, and `fn` then
 * touches only bare names relative to that directory. Replacing any path
 * component afterwards cannot redirect it. Everything inside is synchronous,
 * so no other main-process code observes the moved cwd; main uses absolute
 * paths everywhere else.
 */
function inDir<T>(root: string, dirRel: string, fn: () => T): T {
  const lexical = resolveWithinRoot(root, dirRel || '.');
  if (!lexical) throw new Error('path escapes the project root');
  const realRoot = realpathSync(root);
  const prev = process.cwd();
  process.chdir(lexical);
  try {
    const r = relative(realRoot, process.cwd());
    if (r === '..' || r.startsWith('..' + sep) || isAbsolute(r)) {
      throw new Error('path escapes the project root (symlink)');
    }
    return fn();
  } finally {
    process.chdir(prev);
  }
}

/** Final path component of `rel`, refusing names that are not a single entry. */
function leaf(rel: string): string {
  const name = basename(rel);
  if (!name || name === '.' || name === '..') throw new Error('not a file path');
  return name;
}

const OPEN_READ = fsc.O_RDONLY | fsc.O_NOFOLLOW | fsc.O_NONBLOCK; // FIFO cannot hang main

/**
 * Open a regular file inside the root for reading, race-free. A symlinked
 * final component is followed only if its target is inside the root (then
 * opened, again without following). Caller closes the fd.
 */
function openInRoot(root: string, rel: string, hops = 0): { fd: number; st: Stats } {
  const opened = inDir(root, dirname(rel), () => {
    const name = leaf(rel);
    try {
      return { fd: openSync(name, OPEN_READ) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ELOOP' || hops > 8) throw err;
      return { link: realpathSync(name) }; // candidate only — re-verified below
    }
  });
  if ('link' in opened) {
    const r = relative(realpathSync(root), opened.link);
    if (r === '..' || r.startsWith('..' + sep) || isAbsolute(r)) {
      throw new Error('path escapes the project root (symlink)');
    }
    return openInRoot(root, r, hops + 1);
  }
  const st = fstatSync(opened.fd);
  if (!st.isFile()) {
    closeSync(opened.fd);
    throw new Error('not a file');
  }
  return { fd: opened.fd, st };
}

/** Up to `max` bytes from the start of an open file. */
function readHead(fd: number, max: number): Buffer {
  const buf = Buffer.alloc(max);
  return buf.subarray(0, readSync(fd, buf, 0, max, 0));
}

export function contextFiles(root: string): string[] {
  return CONTEXT_FILES.filter((f) => {
    try {
      return statSync(join(root, f)).isFile();
    } catch {
      return false;
    }
  });
}

export function listDir(root: string, rel = ''): DirListing {
  const entries: DirEntry[] = inDir(root, rel, () =>
    readdirSync('.', { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.') || CONTEXT_FILES.includes(d.name as never))
      .map((d) => {
        let st: Stats | null = null;
        try { st = statSync(d.name); } catch { /* dangling link */ }
        const isDir = d.isDirectory() || (d.isSymbolicLink() && !!st?.isDirectory());
        return { name: d.name, kind: isDir ? ('dir' as const) : ('file' as const), size: isDir ? 0 : (st?.size ?? 0) };
      }),
  ).sort((a, b) => (a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
  return { path: rel.split(sep).filter(Boolean).join('/'), entries };
}

export function readFilePreview(root: string, rel: string): FilePreview {
  const { fd, st } = openInRoot(root, rel);
  try {
    const name = basename(rel);
    const ext = extname(name).toLowerCase();
    const small = st.size <= MAX_PREVIEW_BYTES;
    if (IMG_MIME[ext] && small) {
      return { kind: 'image', name, dataUri: `data:${IMG_MIME[ext]};base64,${readHead(fd, st.size).toString('base64')}` };
    }
    if (ext === '.pdf' && small) {
      return { kind: 'pdf', name, dataUri: `data:application/pdf;base64,${readHead(fd, st.size).toString('base64')}` };
    }
    if (TEXT_EXT.has(ext) || ext === '') {
      return { kind: 'text', name, text: readHead(fd, MAX_PREVIEW_BYTES).toString('utf8'), truncated: !small };
    }
    return { kind: 'unsupported', name, size: st.size };
  } finally {
    closeSync(fd);
  }
}

const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;

/**
 * Current text of a file for checkpointing; null if it does not exist yet.
 * Throws for a file that cannot round-trip as text (binary or huge) — writing
 * it back as UTF-8 would corrupt it, so no checkpoint is better than a bad one.
 */
export function snapshotFile(root: string, rel: string): string | null {
  let opened;
  try {
    opened = openInRoot(root, rel);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const { fd, st } = opened;
  try {
    if (st.size > MAX_SNAPSHOT_BYTES) throw new Error('file too large to checkpoint');
    const buf = readHead(fd, st.size);
    const text = buf.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(buf)) throw new Error('binary file — cannot checkpoint as text');
    return text;
  } finally {
    closeSync(fd);
  }
}

/**
 * Restore a checkpoint. `content === null` means the file did not exist before
 * the edit, so revert deletes it. Race-free against symlink swaps: the parent
 * directory is pinned (inDir), content goes to an exclusive temp file that is
 * then rename()d over the target — rename replaces a symlink rather than
 * following it — and deletion is unlink(), which never follows one either.
 */
export function revertFile(root: string, rel: string, content: string | null): void {
  inDir(root, dirname(rel), () => {
    const name = leaf(rel);
    let st: Stats | null = null;
    try { st = lstatSync(name); } catch { /* absent */ }
    if (st?.isDirectory()) throw new Error('not a file');
    if (content === null) {
      if (st) unlinkSync(name);
      return;
    }
    const tmp = `.${name}.cowork-revert-${randomUUID()}`;
    // 'wx' = O_CREAT|O_EXCL: fails rather than follows if anything exists there.
    writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx', mode: st?.isFile() ? st.mode & 0o7777 : 0o666 });
    try {
      renameSync(tmp, name);
    } catch (err) {
      try { unlinkSync(tmp); } catch { /* ignore */ }
      throw err;
    }
  });
}
