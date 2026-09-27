import { useCoworkStore } from './cowork.store';

export function AdvisorTab() {
  const advisor = useCoworkStore((s) => s.advisor);
  const error = useCoworkStore((s) => s.advisorError);
  const askAdvisor = useCoworkStore((s) => s.askAdvisor);

  return (
    <div className="space-y-3 px-3 py-3 text-[11px]">
      <div className="rounded border border-accent/30 bg-accent/5 p-2">
        <div className="font-medium text-fg">Read-only advisor</div>
        <p className="mt-1 text-dim">A separate consultation. It cannot edit files, run commands, or alter this task.</p>
      </div>
      {advisor.status === 'idle' && (
        <button onClick={() => void askAdvisor()} className="rounded bg-accent px-3 py-1.5 font-semibold text-bg">Ask advisor</button>
      )}
      {advisor.status === 'running' && <p className="text-muted">Advisor is reviewing the task…</p>}
      {advisor.modelId && <p className="text-[10px] text-dim">Model: {advisor.modelId}</p>}
      {error && <p className="text-danger">Advisor failed: {error}</p>}
      {advisor.transcript.length > 0 && (
        <div className="rounded border border-border bg-surface p-2">
          <div className="mb-2 text-[9px] uppercase tracking-wide text-dim">Advisor review</div>
          <div className="whitespace-pre-wrap text-fg">{advisor.transcript.map((m) => m.text).join('')}</div>
        </div>
      )}
      {advisor.status === 'done' && <p className="text-[10px] text-dim">Consultation complete. Advice is not part of the task transcript.</p>}
    </div>
  );
}
