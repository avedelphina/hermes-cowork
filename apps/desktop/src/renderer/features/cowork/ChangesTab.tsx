import { useEffect, useMemo, useState } from 'react';
import { lineDiff, hunks } from '@shared/diff';
import { useCoworkStore } from './cowork.store';

export function ChangesTab({ onOpenFile }: { onOpenFile?: () => void }) {
  const checkpoints = useCoworkStore((s) => s.checkpoints);
  const changeRev = useCoworkStore((s) => s.changeRev);
  const taskId = useCoworkStore((s) => s.taskId);
  const dropCheckpoint = useCoworkStore((s) => s.dropCheckpoint);
  const openInFiles = useCoworkStore((s) => s.openInFiles);
  const [current, setCurrent] = useState<Record<string, string | null>>({});
  const [openRel, setOpenRel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-read every changed file whenever the agent finishes an edit (changeRev)
  // or a new file is checkpointed, so counts and diffs never go stale.
  useEffect(() => {
    if (!taskId) return;
    for (const c of checkpoints) {
      window.hermes.fs.snapshot(taskId, c.rel)
        .then((text) => setCurrent((m) => (m[c.rel] === text ? m : { ...m, [c.rel]: text })))
        .catch(() => { /* ignore */ });
    }
  }, [checkpoints, changeRev, taskId]);

  // LCS is O(n·m) — compute once per (checkpoint, content), not per render.
  const diffs = useMemo(() => {
    const out: Record<string, ReturnType<typeof lineDiff>> = {};
    for (const c of checkpoints) {
      const cur = current[c.rel];
      if (cur !== undefined) out[c.rel] = lineDiff(c.before ?? '', cur ?? '');
    }
    return out;
  }, [checkpoints, current]);

  if (checkpoints.length === 0) {
    return <div className="p-4 text-xs text-muted">Files Hermes edits appear here with a diff and a revert button.</div>;
  }

  const revert = async (rel: string, before: string | null) => {
    if (!taskId) return;
    const what = before === null ? `Delete ${rel}? It did not exist before the agent's edit.` : `Restore ${rel} to its pre-edit content? Later changes to it are lost.`;
    if (!window.confirm(what)) return;
    try {
      await window.hermes.fs.revert(taskId, rel);
      dropCheckpoint(rel);
      setCurrent((m) => ({ ...m, [rel]: before }));
      setError(null);
    } catch (e) {
      setError(`Revert failed: ${String(e)}`);
    }
  };

  const totals = Object.values(diffs).reduce(
    (t, d) => ({ added: t.added + d.added, removed: t.removed + d.removed }),
    { added: 0, removed: 0 },
  );

  return (
    <div className="flex flex-col gap-1.5 px-3 py-3 text-xs">
      <div className="mb-1 flex justify-between text-[10px] text-dim">
        <span>{checkpoints.length} file{checkpoints.length > 1 ? 's' : ''} changed</span>
        <span>
          <span className="text-success">+{totals.added}</span>{' '}
          <span className="text-danger">−{totals.removed}</span>
        </span>
      </div>
      {error && <p className="text-danger">{error}</p>}
      {checkpoints.map((c) => {
        const cur = current[c.rel];
        const d = diffs[c.rel];
        const open = openRel === c.rel;
        const name = c.rel.split('/').pop() ?? c.rel;
        const dir = c.rel.slice(0, c.rel.length - name.length);
        const deleted = c.before !== null && cur === null;
        const unchanged = d !== undefined && d.added === 0 && d.removed === 0;
        return (
          <div key={c.rel} className="rounded border border-border bg-surface">
            <div className="flex items-center gap-1 px-2 py-1.5">
              <button className="min-w-0 flex-1 text-left" onClick={() => setOpenRel(open ? null : c.rel)} title={c.rel}>
                <div className="truncate text-fg">{name}</div>
                <div className="truncate text-[10px] text-dim">{dir}</div>
                <div className="text-[10px]">
                  {d === undefined ? (
                    <span className="text-dim">…</span>
                  ) : deleted ? (
                    <span className="text-danger">deleted</span>
                  ) : unchanged ? (
                    <span className="text-dim">no net change</span>
                  ) : (
                    <>
                      {c.before === null && <span className="mr-1 text-success">new</span>}
                      <span className="text-success">+{d.added}</span>{' '}
                      <span className="text-danger">−{d.removed}</span>
                    </>
                  )}
                </div>
              </button>
              {!deleted && cur !== undefined && (
                <button
                  onClick={() => { openInFiles(c.rel); onOpenFile?.(); }}
                  className="shrink-0 rounded px-1.5 py-1 text-muted hover:text-accent"
                  title="Open in Files"
                >
                  Open
                </button>
              )}
              <button
                onClick={() => void revert(c.rel, c.before)}
                className="shrink-0 rounded px-1.5 py-1 text-muted hover:text-danger"
                title={c.before === null ? 'Delete this new file' : 'Restore the pre-edit content'}
              >
                Revert
              </button>
            </div>
            {open && d && (
              <pre className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words border-t border-border py-1 font-mono text-[10px] leading-4">
                {hunks(d.rows).map((r, i) => (
                  <div
                    key={i}
                    className={
                      'px-2 ' +
                      (r.skipped
                        ? 'bg-surface2 text-dim'
                        : r.type === '+'
                          ? 'bg-success/10 text-success'
                          : r.type === '-'
                            ? 'bg-danger/10 text-danger'
                            : 'text-muted')
                    }
                  >
                    {r.skipped ? r.text : `${r.type} ${r.text}`}
                  </div>
                ))}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
