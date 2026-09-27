import { useCoworkStore, type EvidenceState } from './cowork.store';

const STYLE: Record<EvidenceState, string> = {
  verified: 'border-success/40 bg-success/10 text-success',
  observed: 'border-accent/40 bg-accent/10 text-accent',
  claimed: 'border-border bg-surface2 text-muted',
  failed: 'border-danger/40 bg-danger/10 text-danger',
  stale: 'border-border bg-surface2 text-dim',
};

const LABEL: Record<EvidenceState, string> = {
  verified: 'Verified',
  observed: 'Observed',
  claimed: 'Claimed',
  failed: 'Failed',
  stale: 'Stale',
};

export function EvidenceTab() {
  const evidence = useCoworkStore((s) => s.evidence);

  if (evidence.length === 0) {
    return (
      <div className="p-4 text-xs text-muted">
        Evidence appears here when Cowork observes an ACP operation or receives its result. Assistant prose alone is not evidence.
      </div>
    );
  }

  return (
    <div className="space-y-2 px-3 py-3 text-[11px]">
      <p className="text-[10px] text-dim">
        Evidence is tied to observed ACP events. “Verified” means Cowork received the tool completion event, not that an assistant merely said it worked.
      </p>
      <ol className="space-y-2">
        {evidence.map((item) => (
          <li key={item.id} className="rounded border border-border bg-surface p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-fg">{item.label}</span>
              <span className={`rounded border px-1.5 py-0.5 text-[9px] font-medium ${STYLE[item.state]}`}>
                {LABEL[item.state]}
              </span>
            </div>
            {item.detail && <p className="mt-1 text-dim">{item.detail}</p>}
            {item.paths && item.paths.length > 0 && (
              <p className="mt-1 truncate font-mono text-[10px] text-muted" title={item.paths.join(', ')}>{item.paths.join(', ')}</p>
            )}
            <time className="mt-1 block text-[10px] text-dim">{new Date(item.at).toLocaleTimeString()}</time>
          </li>
        ))}
      </ol>
    </div>
  );
}
