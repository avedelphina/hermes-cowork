// apps/desktop/src/main/fs/project-fs.ts
//
// Read-only filesystem access scoped to a single project root. Every path is
// resolved through resolveWithinRoot AND realpath-checked, so neither `..` nor
// a symlink can escape the root.

import { readdirSync, readFileSync, statSync, realpathSync, writeFileSync, rmSync, openSync, readSync, closeSync } from 'node:fs';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
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

/** Realpath of `p`, or — if it does not exist yet — of its nearest existing
 * ancestor with the missing tail re-appended. A write to a not-yet-existing
 * file still lands wherever its (possibly symlinked) parent points. */
function realpathOrAncestor(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    const parent = dirname(p);
    if (parent === p) return p;
    return join(realpathOrAncestor(parent), basename(p));
  }
}

/** Confirm `rel` stays inside `root` even after resolving symlinks. */
function safeAbs(root: string, rel: string): string {
  const lexical = resolveWithinRoot(root, rel);
  if (!lexical) throw new Error('path escapes the project root');
  const real = realpathOrAncestor(lexical);
  const r = relative(realpathSync(root), real);
  if (r === '..' || r.startsWith('..' + sep)) {
    throw new Error('path escapes the project root (symlink)');
  }
  return real;
}

/** First `max` bytes of a file — never loads a huge file whole. */
function readHead(abs: string, max: number): Buffer {
  const fd = openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(max);
    return buf.subarray(0, readSync(fd, buf, 0, max, 0));
  } finally {
    closeSync(fd);
  }
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
  const abs = safeAbs(root, rel);
  const entries: DirEntry[] = readdirSync(abs, { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.') || CONTEXT_FILES.includes(d.name as never))
    .map((d) => {
      const isDir = d.isDirectory();
      let size = 0;
      if (!isDir) {
        try { size = statSync(join(abs, d.name)).size; } catch { /* ignore */ }
      }
      return { name: d.name, kind: isDir ? ('dir' as const) : ('file' as const), size };
    })
    .sort((a, b) => (a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
  return { path: rel.split(sep).filter(Boolean).join('/'), entries };
}

export function readFilePreview(root: string, rel: string): FilePreview {
  const abs = safeAbs(root, rel);
  const st = statSync(abs);
  if (!st.isFile()) throw new Error('not a file');
  const name = basename(abs);
  const ext = extname(abs).toLowerCase();

  if (IMG_MIME[ext] && st.size <= MAX_PREVIEW_BYTES) {
    return { kind: 'image', name, dataUri: `data:${IMG_MIME[ext]};base64,${readFileSync(abs).toString('base64')}` };
  }
  if (ext === '.pdf' && st.size <= MAX_PREVIEW_BYTES) {
    return { kind: 'pdf', name, dataUri: `data:application/pdf;base64,${readFileSync(abs).toString('base64')}` };
  }
  if (TEXT_EXT.has(ext) || ext === '') {
    const truncated = st.size > MAX_PREVIEW_BYTES;
    return { kind: 'text', name, text: readHead(abs, MAX_PREVIEW_BYTES).toString('utf8'), truncated };
  }
  return { kind: 'unsupported', name, size: st.size };
}

const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;

/**
 * Current text of a file for checkpointing; null if it does not exist yet.
 * Throws for a file that cannot round-trip as text (binary or huge) — writing
 * it back as UTF-8 would corrupt it, so no checkpoint is better than a bad one.
 */
export function snapshotFile(root: string, rel: string): string | null {
  const abs = safeAbs(root, rel);
  let st;
  try {
    st = statSync(abs);
  } catch {
    return null;
  }
  if (!st.isFile()) throw new Error('not a file');
  if (st.size > MAX_SNAPSHOT_BYTES) throw new Error('file too large to checkpoint');
  const buf = readFileSync(abs);
  const text = buf.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buf)) throw new Error('binary file — cannot checkpoint as text');
  return text;
}

/**
 * Restore a checkpoint. `content === null` means the file did not exist before
 * the edit, so revert deletes it. Only ever touches paths inside the root.
 */
export function revertFile(root: string, rel: string, content: string | null): void {
  const abs = safeAbs(root, rel);
  if (content === null) rmSync(abs, { force: true });
  else writeFileSync(abs, content, 'utf8');
}
