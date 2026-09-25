import { useCoworkStore, syncAgentMode, agentState } from './cowork.store';
import { ModelPicker } from '../../shell/ModelPicker';

export function GoalHeader() {
  const { taskId, goal, cwd, profile, remote, planEntries, sessionId, status, approvals, markStopped, beginReconnect } = useCoworkStore();
  const state = agentState(status, approvals.length);
  const total = planEntries.length;
  const done = planEntries.filter((e) => e.status === 'completed').length;

  if (!goal) return null;

  const stop = () => {
    if (sessionId) void window.hermes.acp.stop(sessionId);
    markStopped();
  };

  const reconnect = () => {
    if (!sessionId) return;
    beginReconnect();
    // A reload spawns a fresh ACP child — re-apply the effective mode to it.
    void window.hermes.acp.load({ sessionId, profile, cwd, isolate: true, taskId })
      .then(() => syncAgentMode(useCoworkStore.getState()))
      .catch((e) => useCoworkStore.getState().ingestAcp({ kind: 'session-error', sessionId, message: String(e), fatal: true }))
      .finally(() => useCoworkStore.getState().endReplay());
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
        {remote && (
          <>
            <span>·</span>
            <span className="text-accent" title="This task runs on another machine over SSH">⇄ {remote.sshTarget}</span>
          </>
        )}
        <span>·</span>
        <span className={{ blocked: 'text-warn', working: 'text-success', idle: 'text-dim' }[state]}>
          {{ blocked: '⏸ blocked — needs approval', working: '● working', idle: '○ idle' }[state]}
        </span>
        {total > 0 && (
          <>
            <span>·</span>
            <span className="text-success">{done} of {total} steps done</span>
          </>
        )}
        {sessionId && <ModelPicker key={sessionId} sessionId={sessionId} className="ml-auto" />}
      </div>
    </div>
  );
}
