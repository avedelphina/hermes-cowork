import { useEffect, useState } from 'react';
import { useCoworkStore } from './cowork.store';
import { useWorkersStore, type Worker } from './workers.store';
import { api } from '../../api/rest-client';

const DOT: Record<Worker['status'], string> = {
  queued: 'text-warn',
  running: 'text-accent',
  done: 'text-success',
  failed: 'text-danger',
  stopped: 'text-muted',
};

export function SubtasksTab() {
  const workers = useWorkersStore((s) => s.workers);
  const policy = useWorkersStore((s) => s.policy);
  const setPolicy = useWorkersStore((s) => s.setPolicy);
  const enqueue = useWorkersStore((s) => s.enqueue);
  const stop = useWorkersStore((s) => s.stop);

  const coordinatorSession = useCoworkStore((s) => s.sessionId);
  const cwd = useCoworkStore((s) => s.cwd);
  const pushUserText = useCoworkStore((s) => s.pushUserText);
  const defaultProfile = useCoworkStore((s) => s.profile);

  const [goal, setGoal] = useState('');
  const [profile, setProfile] = useState(() => defaultProfile);
  const [deps, setDeps] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    api.profiles().then((ps) => setProfiles(ps.map((p) => p.name))).catch(() => { /* ignore */ });
  }, []);

  const add = () => {
    if (!goal.trim() || !cwd) return;
    enqueue(goal.trim(), profile, deps);
    setGoal('');
    setDeps([]);
  };

  const synthesize = () => {
    if (!coordinatorSession) return;
    const done = workers.filter((w) => w.status === 'done' || w.status === 'failed' || w.status === 'stopped');
    const parts = done
      .map((w) => `--- Worker (${w.profile}, ${w.status}): ${w.goal} ---\n${w.output.trim() || '(no output)'}`)
      .join('\n\n');
    pushUserText('Synthesize the worker results.');
    void window.hermes.acp.send({
      kind: 'prompt',
      sessionId: coordinatorSession,
      text: `The parallel workers below have finished. Synthesise their results into one coherent answer, and say which worker produced what:\n\n${parts}`,
    });
  };

  if (!cwd) {
    return <div className="p-4 text-xs text-muted">Start a Cowork task to dispatch parallel workers.</div>;
  }

  const finished = workers.filter((w) => w.status !== 'running' && w.status !== 'queued');

  return (
    <div className="flex flex-col gap-2 px-3 py-3 text-xs">
      {/* concurrency + timeout */}
      <div className="flex items-center gap-3 text-[10px] text-dim">
        <label className="flex items-center gap-1">
          max
          <input
            type="number" min={1} max={8} value={policy.maxConcurrent}
            onChange={(e) => setPolicy({ maxConcurrent: Math.max(1, Number(e.target.value) || 1) })}
            aria-label="Max concurrent workers"
            className="w-10 rounded border border-border bg-surface2 px-1 py-0.5 text-fg"
          />
        </label>
        <label className="flex items-center gap-1">
          timeout
          <input
            type="number" min={30} step={30} value={policy.timeoutSec}
            onChange={(e) => setPolicy({ timeoutSec: Math.max(30, Number(e.target.value) || 30) })}
            aria-label="Worker timeout seconds"
            className="w-14 rounded border border-border bg-surface2 px-1 py-0.5 text-fg"
          />s
        </label>
      </div>

      <div className="rounded border border-border bg-surface p-2">
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Worker goal — one concrete sub-task"
          aria-label="Worker goal"
          rows={2}
          className="mb-2 w-full resize-none rounded border border-border bg-surface2 px-2 py-1"
        />
        {workers.length > 0 && (
          <select
            multiple
            value={deps}
            onChange={(e) => setDeps(Array.from(e.target.selectedOptions, (o) => o.value))}
            aria-label="Depends on"
            className="mb-2 w-full rounded border border-border bg-surface2 px-2 py-1"
          >
            {workers.map((w) => (
              <option key={w.id} value={w.id}>after: {w.goal.slice(0, 40)}</option>
            ))}
          </select>
        )}
        <div className="flex gap-2">
          <select
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            aria-label="Worker profile"
            className="flex-1 rounded border border-border bg-surface2 px-2 py-1"
          >
            {(profiles.length ? profiles : [profile]).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button
            onClick={add}
            disabled={!goal.trim()}
            className="rounded bg-accent px-3 py-1 font-semibold text-bg disabled:opacity-50"
          >
            Dispatch
          </button>
        </div>
      </div>

      {workers.length === 0 && <p className="text-muted">No workers yet.</p>}

      {workers.map((w) => {
        const open = openId === w.id;
        return (
          <div key={w.id} className="rounded border border-border bg-surface">
            <div className="flex items-center justify-between px-2 py-1.5">
              <button className="min-w-0 text-left" onClick={() => setOpenId(open ? null : w.id)}>
                <div className="truncate text-fg">{w.goal}</div>
                <div className="text-[10px]">
                  <span className={DOT[w.status]}>● {w.status}</span> <span className="text-dim">{w.profile}</span>
                  {w.dependsOn.length > 0 && <span className="text-dim"> · waits {w.dependsOn.length}</span>}
                </div>
              </button>
              {(w.status === 'running' || w.status === 'queued') && (
                <button onClick={() => stop(w.id)} className="shrink-0 px-2 py-1 text-muted hover:text-danger">
                  Stop
                </button>
              )}
            </div>
            {open && (
              <pre className="max-h-48 overflow-auto border-t border-border px-2 py-1 font-mono text-[10px] leading-4 text-muted">
                {w.output.trim() || (w.status === 'queued' ? '(queued…)' : '(waiting for output…)')}
              </pre>
            )}
          </div>
        );
      })}

      {finished.length > 0 && (
        <button
          onClick={synthesize}
          className="mt-1 rounded border border-border px-3 py-1.5 text-fg hover:border-accent"
        >
          Synthesise results into the coordinator
        </button>
      )}
    </div>
  );
}
