import { useCallback, useEffect, useState } from 'react';
import type { DirListing, FilePreview } from '@shared/types';
import { useCoworkStore } from '../cowork/cowork.store';

function crumbs(path: string): string[] {
  return path ? path.split('/') : [];
}
function parentOf(path: string): string {
  return path.split('/').slice(0, -1).join('/');
}
function isMarkdown(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}
const INSTRUCTION = new Set(['AGENTS.md', 'AGENTS.override.md', 'HERMES.md', '.hermes.md', 'CLAUDE.md', '.cursorrules']);
function isInstruction(name: string): boolean {
  return INSTRUCTION.has(name) || name.endsWith('.mdc');
}
function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Read-only browser over the current Cowork task's working folder. */
export function FileBrowser({ onReview }: { onReview?: (rel: string) => void }) {
  const taskId = useCoworkStore((s) => s.taskId);
  const cwd = useCoworkStore((s) => s.cwd);
  if (!taskId) return <div className="p-4 text-xs text-muted">Start a task to browse its folder.</div>;
  // key on the task id → switching tasks remounts with fresh state.
  return <Browser key={taskId} taskId={taskId} rootName={cwd.split('/').filter(Boolean).pop() ?? cwd} onReview={onReview} />;
}

function Browser({ taskId, rootName, onReview }: { taskId: string; rootName: string; onReview?: (rel: string) => void }) {
  const [dir, setDir] = useState('');
  const [listing, setListing] = useState<DirListing | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const setReviewDraft = useCoworkStore((s) => s.setReviewDraft);
  const setReviewFiles = useCoworkStore((s) => s.setReviewFiles);

  const load = useCallback((rel: string) => {
    window.hermes.fs
      .list(taskId, rel)
      .then((l) => {
        setListing(l);
        setError(null);
        if (!rel) {
          setReviewFiles(l.entries.filter((e) => e.kind === 'file' && isMarkdown(e.name) && !isInstruction(e.name)).map((e) => e.name));
        }
      })
      .catch((e) => setError(String(e)));
  }, [taskId, setReviewFiles]);

  useEffect(() => { load(dir); }, [dir, load]);

  useEffect(() => {
    if (!sel) return;
    window.hermes.fs
      .read(taskId, sel)
      .then((p) => { setPreview(p); setError(null); })
      .catch((e) => setError(String(e)));
  }, [taskId, sel]);

  // Jump to a file requested from the Changes tab.
  const filesTarget = useCoworkStore((s) => s.filesTarget);
  const clearFilesTarget = useCoworkStore((s) => s.clearFilesTarget);
  useEffect(() => {
    if (!filesTarget) return;
    const slash = filesTarget.lastIndexOf('/');
    const targetDir = slash >= 0 ? filesTarget.slice(0, slash) : '';
    window.hermes.fs
      .list(taskId, targetDir)
      .then((l) => { setDir(targetDir); setListing(l); setSel(filesTarget); setError(null); })
      .catch((e) => setError(String(e)));
    clearFilesTarget();
  }, [filesTarget, taskId, clearFilesTarget]);

  const reviewable = !!sel && !!preview && preview.kind === 'text' && isMarkdown(preview.name) && !isInstruction(preview.name);
  const openReview = () => {
    if (!sel) return;
    setReviewBusy(true);
    setReviewNote(null);
    window.hermes.review
      .open(taskId, sel)
      .then(() => setReviewNote('Opened in md-redline. Comment there, then send the comments back.'))
      .catch((e) => setError(String(e)))
      .finally(() => setReviewBusy(false));
  };
  const sendComments = () => {
    if (!sel) return;
    setReviewBusy(true);
    setReviewNote(null);
    window.hermes.review
      .comments(taskId, sel)
      .then((r) => {
        if (!r.comments.length) {
          setReviewNote('No review comments in this file yet.');
          return;
        }
        setReviewDraft(r.prompt);
        setReviewNote(`${r.comments.length} comment${r.comments.length === 1 ? '' : 's'} placed in the composer. Nothing is sent until you send it.`);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setReviewBusy(false));
  };

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="flex items-center gap-1 border-b border-border px-3 py-2 text-[11px] text-muted">
        <button className="hover:text-fg" onClick={() => setDir('')}>{rootName}</button>
        {crumbs(dir).map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-dim">/</span>
            <button className="hover:text-fg" onClick={() => setDir(crumbs(dir).slice(0, i + 1).join('/'))}>{c}</button>
          </span>
        ))}
      </div>

      {error && <p className="px-3 py-2 text-danger">{error}</p>}

      <div className="flex min-h-0 flex-1 flex-col">
        <ul className="max-h-[45%] overflow-y-auto border-b border-border">
          {dir && (
            <li>
              <button className="w-full px-3 py-1.5 text-left text-muted hover:bg-surface2" onClick={() => setDir(parentOf(dir))}>
                ../
              </button>
            </li>
          )}
          {listing?.entries.map((e) => {
            const rel = dir ? `${dir}/${e.name}` : e.name;
            return (
              <li key={e.name}>
                <button
                  onClick={() => (e.kind === 'dir' ? setDir(rel) : setSel(rel))}
                  className={
                    'flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-surface2 ' +
                    (sel === rel ? 'bg-surface2 text-fg' : 'text-muted')
                  }
                >
                  <span className="truncate">{e.kind === 'dir' ? '📁 ' : '📄 '}{e.name}</span>
                  {e.kind === 'file' && <span className="ml-2 shrink-0 text-[10px] text-dim">{fmtSize(e.size)}</span>}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex-1 overflow-auto p-3">
          {!preview && <p className="text-muted">Select a file to preview.</p>}
          {preview?.kind === 'text' && (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-fg">
              {preview.text}
              {preview.truncated && '\n\n… (truncated)'}
            </pre>
          )}
          {preview?.kind === 'image' && <img src={preview.dataUri} alt={preview.name} className="max-w-full" />}
          {preview?.kind === 'pdf' && <embed src={preview.dataUri} type="application/pdf" className="h-64 w-full" />}
          {preview?.kind === 'unsupported' && (
            <p className="text-muted">No preview for {preview.name} ({fmtSize(preview.size)}).</p>
          )}
          {reviewable && (
            <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
              <div className="flex flex-wrap gap-2">
                {onReview && sel && (
                  <button
                    type="button"
                    onClick={() => onReview(sel)}
                    className="rounded bg-accent px-2 py-1 font-semibold text-bg"
                  >
                    Review here
                  </button>
                )}
                <button
                  type="button"
                  disabled={reviewBusy}
                  onClick={openReview}
                  className="rounded border border-border px-2 py-1 text-muted hover:text-fg disabled:opacity-50"
                >
                  Open in md-redline
                </button>
                <button
                  type="button"
                  disabled={reviewBusy}
                  onClick={sendComments}
                  className="rounded border border-border px-2 py-1 text-muted hover:text-fg disabled:opacity-50"
                >
                  Send review comments
                </button>
              </div>
              {reviewNote && <p className="text-[10px] text-dim">{reviewNote}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
