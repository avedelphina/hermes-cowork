import { useCoworkStore } from './cowork.store';
import { Markdown } from '../../components/Markdown';

const STATUS_MARK: Record<string, string> = {
  completed: '✓',
  in_progress: '▸',
  pending: '○',
};

export function PlanTab() {
  const { transcript, planEntries, planHistory, approved, status, sessionId } = useCoworkStore();
  const approvePlan = useCoworkStore((s) => s.approvePlan);
  const markStopped = useCoworkStore((s) => s.markStopped);

  const firstAgent = transcript.find((m) => m.role === 'agent')?.text ?? '';
  const hasProposal = planEntries.length > 0 || firstAgent.trim().length > 0;

  const approve = () => {
    approvePlan();
    if (sessionId) {
      void window.hermes.acp.send({
        kind: 'prompt',
        sessionId,
        text: 'Approved. Proceed with the plan.',
      });
    }
  };

  const decline = () => {
    if (sessionId) void window.hermes.acp.stop(sessionId);
    markStopped();
  };

  const regenerate = () => {
    document.getElementById('composer-input')?.focus();
  };

  if (!hasProposal) {
    return (
      <div className="p-4 text-xs text-muted">
        {status === 'running' ? 'Hermes is drafting a plan…' : 'The plan will appear here.'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-3 text-xs">
      {planHistory.length > 0 && (
        <details className="rounded border border-border">
          <summary className="cursor-pointer px-2 py-1.5 text-dim">
            {planHistory.length} earlier plan{planHistory.length > 1 ? 's' : ''} superseded
          </summary>
          <div className="flex flex-col gap-3 px-2 pb-2">
            {planHistory.map((entries, hi) => (
              <ol key={hi} className="flex flex-col gap-1 opacity-60">
                {entries.map((e, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-dim">{STATUS_MARK[e.status] ?? '○'}</span>
                    <span className="text-muted line-through">{e.content}</span>
                  </li>
                ))}
              </ol>
            ))}
          </div>
        </details>
      )}
      {planEntries.length > 0 ? (
        <ol className="flex flex-col gap-1">
          {planEntries.map((e, i) => (
            <li key={i} className="flex gap-2">
              <span className={e.status === 'completed' ? 'text-success' : e.status === 'in_progress' ? 'text-accent' : 'text-dim'}>
                {STATUS_MARK[e.status] ?? '○'}
              </span>
              <span className={e.status === 'pending' && !approved ? 'text-muted' : 'text-fg'}>{e.content}</span>
            </li>
          ))}
        </ol>
      ) : (
        <Markdown text={firstAgent} className={approved ? 'text-fg' : 'text-muted'} />
      )}

      {!approved ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex gap-2">
            <button
              onClick={approve}
              className="rounded bg-accent px-3 py-1.5 font-semibold text-bg"
            >
              Approve &amp; run
            </button>
            <button
              onClick={regenerate}
              className="rounded border border-border px-3 py-1.5 text-muted hover:text-fg"
            >
              Regenerate with changes
            </button>
            <button
              onClick={decline}
              className="rounded border border-border px-3 py-1.5 text-muted hover:text-danger"
            >
              Abandon
            </button>
          </div>
          <p className="text-[10px] text-dim">
            This plan isn&apos;t final — keep chatting below to reshape it. Nothing runs until you hit Approve.
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[10px] text-success">✓ Plan approved — executing.</p>
      )}
    </div>
  );
}
