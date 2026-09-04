import { useCoworkStore } from './cowork.store';
import { Markdown } from '../../components/Markdown';

export function PlanTab() {
  const { transcript, approved, status, sessionId } = useCoworkStore();
  const approvePlan = useCoworkStore((s) => s.approvePlan);

  const firstAgent = transcript.find((m) => m.role === 'agent')?.text ?? '';
  const hasProposal = firstAgent.trim().length > 0;

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

  if (!hasProposal) {
    return (
      <div className="p-4 text-xs text-muted">
        {status === 'running' ? 'Hermes is drafting a plan…' : 'The plan will appear here.'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-3 text-xs">
      <Markdown text={firstAgent} className={approved ? 'text-fg' : 'text-muted'} />

      {!approved ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <button
            onClick={approve}
            className="rounded bg-accent px-3 py-1.5 font-semibold text-bg"
          >
            Approve &amp; run
          </button>
          <p className="text-[10px] text-dim">
            Or type changes in the composer to revise the plan.
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[10px] text-success">✓ Plan approved — executing.</p>
      )}
    </div>
  );
}
