import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useCoworkStore, MODE_FOR } from './cowork.store';
import { useProjectStore, activeProject } from '../projects/project.store';
import { api } from '../../api/rest-client';

const COWORK_SYSTEM_PROMPT = `You are running in Hermes Cowork mode.

First, propose a concise plan by calling your 'todo' tool — one item per
concrete step, all 'pending' — and then STOP. The plan must go in the tool
call, not in a chat message: the app's Plan panel and progress tracking read
only the tool's list. Do not take any action, edit any file, or run
any command until the user replies to approve the plan. If the user asks for
changes, revise the plan with the same tool and stop again.

Once approved, work through the steps in order. Keep the todo list current:
mark a step 'in_progress' when you start it and 'completed' as soon as it is
done, by calling the tool again.
If the scope changes enough mid-task that the plan itself needs to change —
not just progress on existing steps — update it with the plan tool and STOP
again for re-approval, exactly like the first proposal. Never ask for
approval in a chat reply alone: the todo tool is what puts the review UI in
front of the user, and a plain-text request is easy to miss.

For destructive operations (deleting files, dropping tables, irreversible API
calls) always ask for confirmation inline, regardless of mode.`.trim();

export function NewTaskDialog() {
  // Wait for projects so the folder/profile prefill below sees the active one.
  const projectsLoaded = useProjectStore((s) => s.loaded);
  if (!projectsLoaded) {
    return <div className="mx-auto mt-12 max-w-xl px-6 text-sm text-muted">Loading…</div>;
  }
  return <Dialog />;
}

function Dialog() {
  const proj = activeProject();
  const [goal, setGoal] = useState('');
  const [cwd, setCwd] = useState(() => proj?.folderPath ?? '');
  const [profile, setProfile] = useState(() => proj?.profile ?? 'default');
  const [profiles, setProfiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const startTask = useCoworkStore((s) => s.startTask);

  useEffect(() => {
    api.profiles()
      .then((ps) => {
        setProfiles(ps.map((p) => p.name));
        // Only fall back to the Hermes active profile when no project set one.
        if (!activeProject()) {
          const active = ps.find((p) => p.active)?.name;
          if (active) setProfile(active);
        }
      })
      .catch(() => { /* keep the default */ });
  }, []);

  const pickFolder = async () => {
    const path = await window.hermes.dialog.pickFolder();
    if (path) setCwd(path);
  };

  const submit = async () => {
    if (!goal.trim() || !cwd.trim()) return;
    setBusy(true);
    setError(null);
    let sessionId: string | null = null;
    try {
      // Cowork tasks get their own ACP child so Stop can hard-cancel them.
      ({ sessionId } = await window.hermes.acp.start({ profile, cwd, isolate: true }));
      // Always plan in `default` — "auto" only takes effect once the plan is
      // approved (see agentModeFor). Failing to set it must not start the task.
      await window.hermes.acp.setMode({ sessionId, modeId: MODE_FOR.ask });
      const task = await window.hermes.tasks.create({
        goal, cwd, profile, acpSessionId: sessionId,
        projectId: activeProject()?.id ?? null,
      });
      // Hand the kickoff to CoworkPage: it registers the event listener before
      // sending, so the streamed plan is not lost between routes.
      startTask({
        taskId: task.id, sessionId, goal, cwd, profile,
        kickoff: `${COWORK_SYSTEM_PROMPT}\n\nGoal: ${goal}\nWorking directory: ${cwd}\n\nPropose the plan now.`,
      });
      navigate('/cowork');
    } catch (e) {
      if (sessionId) void window.hermes.acp.stop(sessionId); // no orphaned child
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-12 max-w-xl rounded-lg border border-border bg-surface p-6">
      <h2 className="mb-4 text-lg font-semibold">New Cowork task</h2>

      <label className="mb-1 block text-xs text-muted">Goal</label>
      <textarea
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        rows={3}
        placeholder="e.g. Pull Q2 metrics from Mixpanel and draft the weekly report"
        className="mb-4 w-full rounded border border-border bg-surface2 px-3 py-2 text-sm focus:border-accent focus:outline-none"
      />

      <label className="mb-1 block text-xs text-muted">Working folder (absolute path)</label>
      <div className="mb-4 flex gap-2">
        <input
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="/Users/x/work/q2-report"
          className="flex-1 rounded border border-border bg-surface2 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
        <button onClick={() => { void pickFolder(); }} className="rounded bg-surface2 px-3 py-2 text-xs hover:bg-border">
          Pick…
        </button>
      </div>

      <label className="mb-1 block text-xs text-muted">Profile</label>
      {profiles.length > 0 ? (
        <select
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          className="mb-6 w-full rounded border border-border bg-surface2 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        >
          {profiles.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      ) : (
        <input
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          className="mb-6 w-full rounded border border-border bg-surface2 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
      )}

      {error && <p className="mb-4 text-xs text-danger">{error}</p>}

      <div className="flex justify-end gap-2">
        <button onClick={() => navigate('/cowork')} className="rounded px-3 py-2 text-sm text-muted hover:text-fg">
          Cancel
        </button>
        <button
          onClick={() => { void submit(); }}
          disabled={busy || !goal.trim() || !cwd.trim()}
          className="rounded bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
        >
          {busy ? 'Starting…' : 'Start task'}
        </button>
      </div>
    </div>
  );
}
