import { useCoworkStore } from './cowork.store';
import { ModelPicker } from '../../shell/ModelPicker';

export function GoalHeader() {
  const { goal, cwd, profile, planTasks, sessionId, status, markStopped, beginReconnect } = useCoworkStore();
  const total = planTasks.length;
  const done = planTasks.filter((t) => t.status === 'done').length;

  if (!goal) return null;

  const stop = () => {
    if (sessionId) void window.hermes.acp.stop(sessionId);
    markStopped();
  };

  const reconnect = () => {
    if (!sessionId) return;
    beginReconnect();
    void window.hermes.acp.load({ sessionId, profile, cwd, isolate: true });
  };

  return (
    <div className="border-b border-border px-6 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-dim">Goal</div>
          <div className="mt-1 text-base text-fg">{goal}</div>
        </div>
        {sessionId && (status === 'running' ? (
          <button
            onClick={stop}
            className="shrink-0 rounded border border-border px-2 py-1 text-xs text-muted hover:text-danger"
          >
            ⏹ Stop
          </button>
        ) : (
          <button
            onClick={reconnect}
            className="shrink-0 rounded border border-border px-2 py-1 text-xs text-muted hover:text-accent"
            title="Reload this session from Hermes"
          >
            ↻ Reconnect
          </button>
        ))}
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
        {sessionId && <ModelPicker key={sessionId} sessionId={sessionId} className="ml-auto" />}
      </div>
    </div>
  );
}
