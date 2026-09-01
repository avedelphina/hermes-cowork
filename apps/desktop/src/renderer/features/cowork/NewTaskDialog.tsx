import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useCoworkStore, MODE_FOR } from './cowork.store';
import { api } from '../../api/rest-client';

const COWORK_SYSTEM_PROMPT = `You are running in Hermes Cowork mode.

First, propose a concise numbered plan — one short line per concrete step —
and then STOP. Do not take any action, edit any file, or run any command until
the user replies to approve the plan. If the user asks for changes, revise the
plan and stop again.

Once approved, work through the steps in order, reporting progress as you go.
For destructive operations (deleting files, dropping tables, irreversible API
calls) always ask for confirmation inline, regardless of mode.`.trim();

export function NewTaskDialog() {
  const [goal, setGoal] = useState('');
  const [cwd, setCwd] = useState('');
  const [profile, setProfile] = useState('default');
  const [profiles, setProfiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [, navigate] = useLocation();
  const startTask = useCoworkStore((s) => s.startTask);

  useEffect(() => {
    api.profiles()
      .then((ps) => {
        setProfiles(ps.map((p) => p.name));
        const active = ps.find((p) => p.active)?.name;
        if (active) setProfile(active);
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
    try {
      // Cowork tasks get their own ACP child so Stop can hard-cancel them.
      const { sessionId } = await window.hermes.acp.start({ profile, cwd, isolate: true });
      const mode = useCoworkStore.getState().approvalMode;
      await window.hermes.acp.setMode({ sessionId, modeId: MODE_FOR[mode] }).catch(() => { /* non-fatal */ });
      // Hand the kickoff to CoworkPage: it registers the event listener before
      // sending, so the streamed plan is not lost between routes.
      startTask({
        sessionId, goal, cwd, profile,
        kickoff: `${COWORK_SYSTEM_PROMPT}\n\nGoal: ${goal}\nWorking directory: ${cwd}\n\nPropose the plan now.`,
      });
      navigate('/cowork');
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
