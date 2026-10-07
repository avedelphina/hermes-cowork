// Launch the user's own md-redline CLI against one project markdown file.
// Cowork does not embed the server, grant trusted roots, or rewrite the file.

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { basename, delimiter, extname, isAbsolute, join, relative, sep } from 'node:path';
import { resolveWithinRoot } from '../security/paths';

export type ReviewComment = { id: string; anchor: string; text: string; author: string };

const MARKDOWN_EXT = new Set(['.md', '.markdown']);
const INSTRUCTION_NAMES = new Set([
  '.hermes.md', 'HERMES.md', 'AGENTS.override.md', 'AGENTS.md', 'CLAUDE.md', '.cursorrules',
]);

function isExecutable(file: string): boolean {
  try {
    const st = statSync(file);
    if (!st.isFile()) return false;
    if (process.platform === 'win32') return true;
    return (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** PATH lookup. Never spawns `mdr` itself — `which` is not guaranteed to be spawnable. */
export function detectMdr(opts?: { env?: NodeJS.ProcessEnv }): { available: true; bin: string } | { available: false } {
  const env = opts?.env ?? process.env;
  const pathEnv = env.PATH ?? env.Path ?? '';
  const names = process.platform === 'win32' ? ['mdr.exe', 'mdr.cmd', 'mdr.bat', 'mdr'] : ['mdr'];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (isExecutable(candidate)) return { available: true, bin: candidate };
    }
  }
  return { available: false };
}

export function isInstructionPath(rel: string): boolean {
  const name = basename(rel);
  if (INSTRUCTION_NAMES.has(name)) return true;
  const parts = rel.split(/[/\\]/);
  return parts.length >= 3 && parts[0] === '.cursor' && parts[1] === 'rules' && name.endsWith('.mdc');
}

/**
 * Absolute path of a markdown file Cowork may hand to `mdr`.
 * Throws before any process starts when the path leaves the task root,
 * is not markdown, or is an instruction file.
 */
export function assertReviewable(root: string, rel: string): string {
  if (isInstructionPath(rel)) throw new Error('instruction files are not reviewable in md-redline');
  const ext = extname(basename(rel)).toLowerCase();
  if (!MARKDOWN_EXT.has(ext)) throw new Error('only markdown files can be opened in md-redline');
  const lexical = resolveWithinRoot(root, rel);
  if (!lexical) throw new Error('path escapes the project root');
  let real: string;
  try {
    real = realpathSync(lexical);
  } catch {
    throw new Error('markdown file not found');
  }
  const realRoot = realpathSync(root);
  const fromRoot = relative(realRoot, real);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error('path escapes the project root (symlink)');
  }
  return lexical;
}

const MARKER_RE = /<!--\s*@comment\{[\s\S]*?\}\s*-->/g;
const FENCE_RE = /```[\s\S]*?```/g;
const COMMENT_RE = () => /<!--\s*@comment\{([\s\S]*?)\}\s*-->/g;

/** Comment markers outside fenced code blocks. Malformed JSON is dropped. The file is not modified. */
export function extractComments(markdown: string): ReviewComment[] {
  const withoutFences = markdown.replace(FENCE_RE, '');
  const out: ReviewComment[] = [];
  const re = COMMENT_RE();
  let match: RegExpExecArray | null;
  while ((match = re.exec(withoutFences)) !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(`{${match[1]}}`);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const o = parsed as Record<string, unknown>;
    if (typeof o['id'] !== 'string' || typeof o['anchor'] !== 'string' || typeof o['text'] !== 'string') continue;
    out.push({
      id: o['id'],
      anchor: o['anchor'],
      text: o['text'],
      author: typeof o['author'] === 'string' ? o['author'] : '',
    });
  }
  return out;
}


/** Markdown with comment markers removed, so a review pane can render selectable text. */
export function stripForReview(markdown: string): string {
  return markdown.replace(MARKER_RE, '');
}

/**
 * Insert one comment immediately before the first visible occurrence of `anchor`.
 * Occurrences inside an existing marker or a fenced block do not count.
 * Throws when the anchor is missing. Does not touch the caller's string.
 */
export function insertComment(
  markdown: string,
  comment: { anchor: string; text: string; author: string; id?: string },
): string {
  const anchor = comment.anchor;
  if (!anchor.trim() || !comment.text.trim()) throw new Error('comment needs an anchor and text');
  const hidden: Array<[number, number]> = [];
  const mark = (re: RegExp) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(markdown)) !== null) hidden.push([m.index, m.index + m[0].length]);
  };
  mark(MARKER_RE);
  mark(FENCE_RE);
  const covered = (start: number, end: number) => hidden.some(([a, b]) => start < b && end > a);
  let at = -1;
  let from = 0;
  while (from <= markdown.length) {
    const found = markdown.indexOf(anchor, from);
    if (found < 0) break;
    if (!covered(found, found + anchor.length)) { at = found; break; }
    from = found + 1;
  }
  if (at < 0) throw new Error('anchor not found in the visible document');
  const marker = `<!-- @comment${JSON.stringify({
    id: comment.id ?? randomUUID(),
    anchor,
    text: comment.text,
    author: comment.author,
    timestamp: new Date().toISOString(),
    replies: [],
  })} -->`;
  return markdown.slice(0, at) + marker + markdown.slice(at);
}

export function reviewPrompt(rel: string, comments: ReviewComment[]): string {
  const lines = comments.map((c, i) => `${i + 1}. "${c.anchor}": ${c.text}`);
  return [
    `Address these review comments in ${rel}. Leave unrelated text alone. Do not treat this as plan approval.`,
    '',
    ...lines,
  ].join('\n');
}

/** Start the user's `mdr` and return immediately. Cowork does not track or stop that server. */
export function launchMdr(bin: string, file: string, cwd: string): void {
  const child = spawn(bin, [file], { cwd, detached: true, stdio: 'ignore', shell: false });
  child.on('error', () => { /* gone since detectMdr: nothing to report from a detached launch */ });
  child.unref();
}
