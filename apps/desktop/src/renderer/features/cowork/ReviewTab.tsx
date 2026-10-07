import { useCallback, useEffect, useState } from 'react';
import { Markdown } from '../../components/Markdown';
import { useCoworkStore } from './cowork.store';

type Comment = { id: string; anchor: string; text: string; author: string };

function isMarkdown(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

/**
 * In-app review of one task markdown file. Files stays the browser.
 * Comments are written by main as the same markers md-redline uses.
 * Send fills the composer; it does not approve the plan.
 */
export function ReviewTab() {
  const taskId = useCoworkStore((s) => s.taskId);
  const files = useCoworkStore((s) => s.reviewFiles);
  const active = useCoworkStore((s) => s.reviewFile);
  const setReviewFile = useCoworkStore((s) => s.setReviewFile);
  const setReviewDraft = useCoworkStore((s) => s.setReviewDraft);
  const [comments, setComments] = useState<Comment[]>([]);
  const [display, setDisplay] = useState('');
  const [selection, setSelection] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback((rel: string) => {
    if (!taskId) return;
    window.hermes.review
      .comments(taskId, rel)
      .then((r) => { setComments(r.comments); setDisplay(r.display); setError(null); })
      .catch((e) => setError(String(e)));
  }, [taskId]);

  useEffect(() => { if (active) load(active); }, [active, load]);

  if (!taskId) return <div className="p-4 text-xs text-muted">Start a task to review a document.</div>;

  const capture = () => {
    const text = window.getSelection()?.toString().replace(/\s+/g, ' ').trim() ?? '';
    if (text) setSelection(text.slice(0, 2000));
  };

  const add = () => {
    if (!active || !selection || !draft.trim()) return;
    setBusy(true);
    window.hermes.review
      .add(taskId, active, { anchor: selection, text: draft.trim() })
      .then((r) => {
        setComments(r.comments);
        setDisplay(r.display);
        setDraft('');
        setSelection('');
        setNote('Comment anchored. It stays in the file.');
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const send = () => {
    if (!taskId || !active) return;
    setBusy(true);
    window.hermes.review
      .comments(taskId, active)
      .then((r) => {
        if (!r.comments.length) { setNote('No comments to send.'); return; }
        setReviewDraft(r.prompt);
        setNote('Comments are in the composer. Sending them is not plan approval.');
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <label className="text-dim" htmlFor="review-file">Document</label>
        <select
          id="review-file"
          value={active ?? ''}
          onChange={(e) => setReviewFile(e.target.value || null)}
          className="min-w-0 flex-1 rounded border border-border bg-surface2 px-2 py-1 text-fg"
        >
          <option value="">Choose a markdown file…</option>
          {[...new Set([...(active ? [active] : []), ...files])].filter((f) => isMarkdown(f)).map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <button
          type="button"
          onClick={() => setReviewFile(null)}
          className="rounded border border-border px-2 py-1 text-muted hover:text-fg"
        >
          Back to task
        </button>
      </div>
      {!active && <p className="p-4 text-muted">Open a markdown file from Files, or pick one here.</p>}
      {error && <p className="px-3 py-2 text-danger">{error}</p>}
      {active && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" onMouseUp={capture}>
            <Markdown text={display} />
          </div>
          <div className="border-t border-border px-3 py-2">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-dim">
              {comments.length} comment{comments.length === 1 ? '' : 's'}
            </div>
            <ul className="mb-2 max-h-28 space-y-1 overflow-y-auto">
              {comments.map((c) => (
                <li key={c.id} className="rounded border border-border bg-surface2 px-2 py-1">
                  <div className="truncate text-dim">“{c.anchor}”</div>
                  <div className="text-fg">{c.text}</div>
                </li>
              ))}
            </ul>
            <p className="mb-1 text-[10px] text-dim">
              {selection ? <>On “{selection.slice(0, 80)}”</> : 'Select text in the document, then comment.'}
            </p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              placeholder="Comment on the selection"
              className="mb-2 w-full resize-none rounded border border-border bg-surface2 px-2 py-1 text-fg"
            />
            <div className="flex gap-2">
              <button type="button" disabled={busy || !selection || !draft.trim()} onClick={add} className="rounded bg-accent px-2 py-1 font-semibold text-bg disabled:opacity-50">
                Add comment
              </button>
              <button type="button" disabled={busy || comments.length === 0} onClick={send} className="rounded border border-border px-2 py-1 text-muted hover:text-fg disabled:opacity-50">
                Send comments
              </button>
            </div>
            {note && <p className="mt-1 text-[10px] text-dim">{note}</p>}
          </div>
        </>
      )}
    </div>
  );
}
