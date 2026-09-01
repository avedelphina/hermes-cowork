import { useEffect, useState } from 'react';
import { useCoworkStore } from './cowork.store';
import { useWorkersStore, spawnWorker, stopWorker, type Worker } from './workers.store';
import { api } from '../../api/rest-client';

const DOT: Record<Worker['status'], string> = {
  running: 'text-accent',
  done: 'text-success',
  failed: 'text-danger',
  stopped: 'text-muted',
};

export function SubtasksTab() {
  const workers = useWorkersStore((s) => s.workers);
  const coordinatorSession = useCoworkStore((s) => s.sessionId);
  const cwd = useCoworkStore((s) => s.cwd);
  const pushUserText = useCoworkStore((s) => s.pushUserText);
  const defaultProfile = useCoworkStore((s) => s.profile);

  const [goal, setGoal] = useState('');
  const [profile, setProfile] = useState(() => defaultProfile);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    api.profiles().then((ps) => setProfiles(ps.map((p) => p.name))).catch(() => { /* ignore */ });
  }, []);

  const add = async () => {
    if (!goal.trim() || !cwd) return;
    const g = goal.trim();
    setGoal('');
    await spawnWorker(g, profile);
  };

  const synthesize = () => {
    if (!coordinatorSession) return;
    const done = workers.filter((w) => w.status !== 'running');
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

  return (
    <div className="flex flex-col gap-2 px-3 py-3 text-xs">
      <div className="rounded border border-border bg-surface p-2">
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Worker goal — one concrete sub-task"
          aria-label="Worker goal"
          rows={2}
          className="mb-2 w-full resize-none rounded border border-border bg-surface2 px-2 py-1"
        />
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
            onClick={() => void add()}
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
                </div>
              </button>
              {w.status === 'running' && (
                <button onClick={() => stopWorker(w)} className="shrink-0 px-2 py-1 text-muted hover:text-danger">
                  Stop
                </button>
              )}
            </div>
            {open && (
              <pre className="max-h-48 overflow-auto border-t border-border px-2 py-1 font-mono text-[10px] leading-4 text-muted">
                {w.output.trim() || '(waiting for output…)'}
              </pre>
            )}
          </div>
        );
      })}

      {workers.some((w) => w.status !== 'running') && (
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
