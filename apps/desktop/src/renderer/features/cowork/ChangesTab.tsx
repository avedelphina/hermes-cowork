import { useEffect, useState } from 'react';
import { lineDiff, type DiffRow } from '@shared/diff';
import { useCoworkStore } from './cowork.store';

export function ChangesTab() {
  const checkpoints = useCoworkStore((s) => s.checkpoints);
  const cwd = useCoworkStore((s) => s.cwd);
  const dropCheckpoint = useCoworkStore((s) => s.dropCheckpoint);
  const [current, setCurrent] = useState<Record<string, string | null>>({});
  const [openRel, setOpenRel] = useState<string | null>(null);

  useEffect(() => {
    for (const c of checkpoints) {
      window.hermes.fs.snapshot(cwd, c.rel)
        .then((text) => setCurrent((m) => ({ ...m, [c.rel]: text })))
        .catch(() => { /* ignore */ });
    }
  }, [checkpoints, cwd]);

  if (checkpoints.length === 0) {
    return <div className="p-4 text-xs text-muted">Edits appear here with a diff and a revert button.</div>;
  }

  const revert = async (rel: string, before: string | null) => {
    await window.hermes.fs.revert(cwd, rel, before);
    dropCheckpoint(rel);
    setCurrent((m) => ({ ...m, [rel]: before }));
  };

  return (
    <div className="flex flex-col gap-1 px-3 py-3 text-xs">
      {checkpoints.map((c) => {
        const cur = current[c.rel];
        const d = lineDiff(c.before ?? '', cur ?? '');
        const open = openRel === c.rel;
        return (
          <div key={c.rel} className="rounded border border-border bg-surface">
            <div className="flex items-center justify-between px-2 py-1.5">
              <button className="min-w-0 text-left" onClick={() => setOpenRel(open ? null : c.rel)}>
                <div className="truncate text-fg">{c.rel}</div>
                <div className="text-[10px]">
                  {c.before === null && <span className="text-success">new file</span>}
                  {c.before !== null && (
                    <>
                      <span className="text-success">+{d.added}</span>{' '}
                      <span className="text-danger">−{d.removed}</span>
                    </>
                  )}
                </div>
              </button>
              <button
                onClick={() => void revert(c.rel, c.before)}
                className="shrink-0 rounded px-2 py-1 text-muted hover:text-danger"
                title={c.before === null ? 'Delete this new file' : 'Restore the pre-edit content'}
              >
                Revert
              </button>
            </div>
            {open && (
              <pre className="max-h-56 overflow-auto border-t border-border px-2 py-1 font-mono text-[10px] leading-4">
                {d.rows.map((r: DiffRow, i) => (
                  <div
                    key={i}
                    className={r.type === '+' ? 'text-success' : r.type === '-' ? 'text-danger' : 'text-muted'}
                  >
                    {r.type}
                    {r.text}
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
