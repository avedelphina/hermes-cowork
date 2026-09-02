import { useCallback, useEffect, useState } from 'react';
import type { ProfileSummary } from '../../api/schemas';
import { api } from '../../api/rest-client';

export function ProfilesManager() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [cloneFrom, setCloneFrom] = useState('__default__');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api.profiles(), window.hermes.rest.get<{ active?: string }>('/api/profiles/active')])
      .then(([ps, a]) => { setProfiles(ps); setActive(a.active ?? null); setError(null); })
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name: name.trim() };
      if (cloneFrom === '__default__') body.clone_from_default = true;
      else if (cloneFrom !== '__none__') body.clone_from = cloneFrom;
      await window.hermes.rest.post('/api/profiles', body);
      setName('');
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (n: string) => {
    setBusy(true);
    setError(null);
    try {
      await window.hermes.rest.del(`/api/profiles/${encodeURIComponent(n)}`);
      setConfirmDelete(null);
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-10 max-w-2xl px-6">
      <h2 className="mb-4 text-lg font-semibold">Profiles</h2>

      <div className="mb-6 rounded-lg border border-border bg-surface p-4">
        <label className="mb-1 block text-xs text-muted">New profile name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="research"
          className="mb-3 w-full rounded border border-border bg-surface2 px-3 py-2 text-sm"
        />
        <label className="mb-1 block text-xs text-muted">Clone from</label>
        <select
          value={cloneFrom}
          onChange={(e) => setCloneFrom(e.target.value)}
          className="mb-3 w-full rounded border border-border bg-surface2 px-3 py-2 text-sm"
        >
          <option value="__default__">default profile</option>
          <option value="__none__">nothing (blank)</option>
          {profiles.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
        {error && <p className="mb-2 text-xs text-danger">{error}</p>}
        <button
          onClick={() => void create()}
          disabled={busy || !name.trim()}
          className="rounded bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
        >
          Create profile
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {profiles.map((p) => (
          <li key={p.name} className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm">
                {p.name === active && <span className="text-accent">●</span>}
                <span className="font-medium">{p.name}</span>
                <span className="text-[10px] text-dim">{[p.provider, p.model].filter(Boolean).join(' · ')}</span>
              </div>
              <div className="truncate text-[11px] text-muted">{p.hermesHome}</div>
            </div>
            {p.name === active ? (
              <span className="shrink-0 text-[10px] text-dim">active</span>
            ) : confirmDelete === p.name ? (
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <span className="text-danger">Delete profile + its folder?</span>
                <button onClick={() => void remove(p.name)} disabled={busy} className="rounded bg-danger px-2 py-1 text-bg">
                  Delete
                </button>
                <button onClick={() => setConfirmDelete(null)} className="text-muted">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(p.name)}
                className="shrink-0 rounded px-2 py-1 text-xs text-muted hover:text-danger"
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-[11px] text-dim">
        Deleting a profile removes its folder under <code>~/.hermes/profiles/</code> and cannot be undone.
        Export / import are done from the Hermes dashboard for now.
      </p>
    </div>
  );
}
