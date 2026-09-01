import { useEffect, useState } from 'react';
import { useProjectStore } from './project.store';
import { api } from '../../api/rest-client';

export function ProjectsPage() {
  const { projects, activeId, loaded, load, setActive, remove } = useProjectStore();
  const [profiles, setProfiles] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [profile, setProfile] = useState('default');
  const [error, setError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<Record<string, string[]>>({});

  useEffect(() => {
    for (const p of projects) {
      window.hermes.projects.contextFiles(p.id)
        .then((files) => setCtx((c) => ({ ...c, [p.id]: files })))
        .catch(() => { /* ignore */ });
    }
  }, [projects]);

  useEffect(() => {
    if (!loaded) void load();
    api.profiles()
      .then((ps) => {
        setProfiles(ps.map((p) => p.name));
        const active = ps.find((p) => p.active)?.name;
        if (active) setProfile(active);
      })
      .catch(() => { /* keep default */ });
  }, [loaded, load]);

  const pick = async () => {
    const path = await window.hermes.dialog.pickFolder();
    if (path) {
      setFolder(path);
      if (!name) setName(path.split('/').filter(Boolean).pop() ?? '');
    }
  };

  const create = async () => {
    setError(null);
    try {
      await window.hermes.projects.create({ name, folderPath: folder, profile });
      await load();
      setCreating(false);
      setName('');
      setFolder('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mx-auto mt-10 max-w-2xl px-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Projects</h2>
        <button
          onClick={() => setCreating((v) => !v)}
          className="rounded bg-surface2 px-3 py-1.5 text-xs hover:bg-border"
        >
          {creating ? 'Cancel' : '+ New project'}
        </button>
      </div>

      {creating && (
        <div className="mb-6 rounded-lg border border-border bg-surface p-4">
          <label className="mb-1 block text-xs text-muted">Folder</label>
          <div className="mb-3 flex gap-2">
            <input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="/Users/x/work/site"
              className="flex-1 rounded border border-border bg-surface2 px-3 py-2 text-sm"
            />
            <button onClick={() => void pick()} className="rounded bg-surface2 px-3 py-2 text-xs hover:bg-border">
              Pick…
            </button>
          </div>
          <label className="mb-1 block text-xs text-muted">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Site redesign"
            className="mb-3 w-full rounded border border-border bg-surface2 px-3 py-2 text-sm"
          />
          <label className="mb-1 block text-xs text-muted">Profile</label>
          <select
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            className="mb-3 w-full rounded border border-border bg-surface2 px-3 py-2 text-sm"
          >
            {(profiles.length ? profiles : [profile]).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          {error && <p className="mb-2 text-xs text-danger">{error}</p>}
          <button
            onClick={() => void create()}
            disabled={!folder.trim()}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
          >
            Create project
          </button>
        </div>
      )}

      {projects.length === 0 ? (
        <p className="text-sm text-muted">No projects yet. Create one from a local folder.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map((p) => (
            <li
              key={p.id}
              className={
                'flex items-center justify-between rounded-lg border px-4 py-3 ' +
                (p.id === activeId ? 'border-accent bg-surface2' : 'border-border bg-surface')
              }
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  {p.id === activeId && <span className="text-accent">●</span>}
                  <span className="font-medium">{p.name}</span>
                  <span className="text-[10px] text-dim">{p.profile}</span>
                </div>
                <div className="truncate text-[11px] text-muted">{p.folderPath}</div>
                <div className="mt-0.5 text-[10px] text-dim">
                  {ctx[p.id]?.length
                    ? `context: ${(ctx[p.id] ?? []).join(', ')}`
                    : 'no AGENTS.md / .hermes.md'}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                {p.id !== activeId && (
                  <button
                    onClick={() => void setActive(p.id)}
                    className="rounded bg-surface2 px-2 py-1 text-xs hover:bg-border"
                  >
                    Open
                  </button>
                )}
                <button
                  onClick={() => void remove(p.id)}
                  className="rounded px-2 py-1 text-xs text-muted hover:text-danger"
                  title="Remove from app — does not delete the folder"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
