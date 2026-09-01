// apps/desktop/src/main/fs/project-fs.ts
//
// Read-only filesystem access scoped to a single project root. Every path is
// resolved through resolveWithinRoot AND realpath-checked, so neither `..` nor
// a symlink can escape the root.

import { readdirSync, readFileSync, statSync, realpathSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
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

/** Confirm `rel` stays inside `root` even after resolving symlinks. */
function safeAbs(root: string, rel: string): string {
  const lexical = resolveWithinRoot(root, rel);
  if (!lexical) throw new Error('path escapes the project root');
  let real: string;
  try {
    real = realpathSync(lexical);
  } catch {
    return lexical; // does not exist yet — lexical check already passed
  }
  const realRoot = realpathSync(root);
  const r = relative(realRoot, real);
  if (r !== '' && (r === '..' || r.startsWith('..' + sep))) {
    throw new Error('path escapes the project root (symlink)');
  }
  return real;
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
    const buf = readFileSync(abs, { encoding: 'utf8' });
    const truncated = Buffer.byteLength(buf) > MAX_PREVIEW_BYTES;
    return { kind: 'text', name, text: truncated ? buf.slice(0, MAX_PREVIEW_BYTES) : buf, truncated };
  }
  return { kind: 'unsupported', name, size: st.size };
}
