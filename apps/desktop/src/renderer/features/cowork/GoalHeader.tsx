import { useCoworkStore } from './cowork.store';

export function GoalHeader() {
  const { goal, cwd, profile, planTasks, sessionId, status, markStopped } = useCoworkStore();
  const total = planTasks.length;
  const done = planTasks.filter((t) => t.status === 'done').length;

  if (!goal) return null;

  const stop = () => {
    if (sessionId) void window.hermes.acp.stop(sessionId);
    markStopped();
  };

  return (
    <div className="border-b border-border px-6 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-dim">Goal</div>
          <div className="mt-1 text-base text-fg">{goal}</div>
        </div>
        {status === 'running' && sessionId && (
          <button
            onClick={stop}
            className="shrink-0 rounded border border-border px-2 py-1 text-xs text-muted hover:text-danger"
          >
            ⏹ Stop
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
        <span>📁 {cwd}</span>
        <span>·</span>
        <span>👤 {profile}</span>
        <span>·</span>
        <span className={status === 'running' ? 'text-success' : 'text-dim'}>
          {status === 'running' ? '● working' : '○ idle'}
        </span>
        {total > 0 && (
          <>
            <span>·</span>
            <span className="text-success">step {done + 1} of {total}</span>
          </>
        )}
      </div>
    </div>
  );
}
