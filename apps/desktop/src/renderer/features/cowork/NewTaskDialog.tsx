import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useCoworkStore } from './cowork.store';
import { useProjectStore, activeProject } from '../projects/project.store';
import { api } from '../../api/rest-client';

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
  const remote = proj?.remote ?? null;
  const [title, setTitle] = useState('');
  const [cwd, setCwd] = useState(() => proj?.folderPath ?? '');
  const [profile, setProfile] = useState(() => proj?.profile ?? 'default');
  const [profiles, setProfiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, navigate] = useLocation();

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
    if (!title.trim() || !cwd.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const task = await window.hermes.tasks.create({
        title, cwd, profile,
        projectId: activeProject()?.id ?? null,
      });
      useCoworkStore.getState().restoreTask(task);
      navigate('/cowork');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-12 max-w-xl rounded-lg border border-border bg-surface p-6">
      <h2 className="mb-4 text-lg font-semibold">New Cowork task</h2>

      <label className="mb-1 block text-xs text-muted">Task name</label>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. Redesign the macOS app"
        className="mb-4 w-full rounded border border-border bg-surface2 px-3 py-2 text-sm focus:border-accent focus:outline-none"
      />

      <label className="mb-1 block text-xs text-muted">
        Working folder (absolute path{remote ? ` on ${remote.sshTarget}` : ''})
      </label>
      <div className="mb-4 flex gap-2">
        <input
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="/Users/x/work/q2-report"
          className="flex-1 rounded border border-border bg-surface2 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
        {!remote && (
          <button onClick={() => { void pickFolder(); }} className="rounded bg-surface2 px-3 py-2 text-xs hover:bg-border">
            Pick…
          </button>
        )}
      </div>

      {remote && (
        <p className="mb-4 -mt-2 text-[11px] text-accent">
          ⇄ Remote task — the agent runs on {remote.sshTarget} over SSH. Set on the project.
        </p>
      )}

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
          disabled={busy || !title.trim() || !cwd.trim()}
          className="rounded bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create task'}
        </button>
      </div>
    </div>
  );
}
