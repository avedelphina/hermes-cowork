import { useEffect, useState } from 'react';
import type { Context, ContextEntry, Project } from '@shared/types';
import { useProjectStore } from './project.store';
import { api } from '../../api/rest-client';

export function ProjectsPage() {
  const { projects, activeId, loaded, load, setActive, remove, update } = useProjectStore();
  const [profiles, setProfiles] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [profile, setProfile] = useState('default');
  const [sshTarget, setSshTarget] = useState('');
  const [contexts, setContexts] = useState<Context[]>([]);
  const [contextId, setContextId] = useState<string>('');
  const [contextName, setContextName] = useState('');
  const [contextFundingRef, setContextFundingRef] = useState('');
  const [projectFundingRef, setProjectFundingRef] = useState('');
  const [creatingContext, setCreatingContext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<Record<string, ContextEntry[]>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editing2, setEditing2] = useState<string | null>(null); // project in full-edit form
  const [form, setForm] = useState({ name: '', folderPath: '', contextId: '', fundingRef: '' });
  const [editingContext, setEditingContext] = useState<string | null>(null);
  const [ctxForm, setCtxForm] = useState({ name: '', fundingRef: '' });

  const reloadContexts = async () => {
    const snap = await window.hermes.contexts.list();
    setContexts(snap.contexts);
  };

  useEffect(() => {
    void window.hermes.contexts.list().then((snap) => setContexts(snap.contexts));
  }, []);

  useEffect(() => {
    // Scan instruction files only for the open project, not the whole list.
    const p = projects.find((x) => x.id === activeId);
    if (!p) return;
    window.hermes.projects.contextFiles(p.id)
      .then((files) => setCtx((c) => ({ ...c, [p.id]: files })))
      .catch(() => { /* ignore */ });
  }, [projects, activeId]);

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
      await window.hermes.projects.create({
        name, folderPath: folder.trim() || null, profile,
        remote: sshTarget.trim() ? { sshTarget: sshTarget.trim() } : null,
        contextId: contextId || null,
        fundingRef: projectFundingRef.trim() || null,
      });
      await load();
      setCreating(false);
      setName('');
      setFolder('');
      setSshTarget('');
      setContextId('');
      setProjectFundingRef('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const createContext = async () => {
    setError(null);
    try {
      const context = await window.hermes.contexts.create({
        name: contextName.trim(), fundingRef: contextFundingRef.trim() || null,
      });
      await reloadContexts();
      setContextId(context.id);
      setContextName('');
      setContextFundingRef('');
      setCreatingContext(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const commitRename = async () => {
    if (editing && editName.trim()) await update(editing, { name: editName.trim() });
    setEditing(null);
  };

  const startEdit = (p: Project) => {
    setEditing2(p.id);
    setForm({ name: p.name, folderPath: p.folderPath ?? '', contextId: p.contextId ?? '', fundingRef: p.fundingRef ?? '' });
  };

  const saveEdit = async () => {
    if (!editing2) return;
    setError(null);
    try {
      await update(editing2, {
        name: form.name.trim(),
        folderPath: form.folderPath.trim() || null,
        contextId: form.contextId || null,
        fundingRef: form.fundingRef.trim() || null,
      });
      setEditing2(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveContext = async () => {
    if (!editingContext) return;
    setError(null);
    try {
      await window.hermes.contexts.update(editingContext, {
        name: ctxForm.name.trim(), fundingRef: ctxForm.fundingRef.trim() || null,
      });
      await reloadContexts();
      setEditingContext(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const live = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);
  const contextById = new Map(contexts.map((context) => [context.id, context]));

  const input = 'w-full rounded border border-border bg-surface2 px-2 py-1.5 text-sm';
  const editForm = () => (
    <div className="flex w-full flex-col gap-2">
      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" className={input} />
      <div className="flex gap-2">
        <input value={form.folderPath} onChange={(e) => setForm({ ...form, folderPath: e.target.value })} placeholder="Folder (empty = chat only)" className={input} />
        <button
          onClick={() => void window.hermes.dialog.pickFolder().then((f) => f && setForm((v) => ({ ...v, folderPath: f })))}
          className="rounded bg-surface2 px-3 text-xs hover:bg-border"
        >
          Pick…
        </button>
      </div>
      <select value={form.contextId} onChange={(e) => setForm({ ...form, contextId: e.target.value })} className={input}>
        <option value="">No context</option>
        {contexts.filter((c) => !c.archived || c.id === form.contextId).map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <input value={form.fundingRef} onChange={(e) => setForm({ ...form, fundingRef: e.target.value })} placeholder="Purser wallet / funding reference (overrides context)" className={input} />
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => void saveEdit()} disabled={!form.name.trim()} className="rounded bg-accent px-3 py-1 text-xs font-semibold text-bg disabled:opacity-50">Save</button>
        <button onClick={() => setEditing2(null)} className="rounded px-3 py-1 text-xs text-muted hover:text-fg">Cancel</button>
      </div>
    </div>
  );

  const row = (p: Project) => (
    <li
      key={p.id}
      className={
        'flex items-center justify-between rounded-lg border px-4 py-3 ' +
        (p.id === activeId ? 'border-accent bg-surface2' : 'border-border bg-surface') +
        (p.archived ? ' opacity-60' : '')
      }
    >
      {editing2 === p.id ? editForm() : <>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm">
          {p.id === activeId && <span className="text-accent">●</span>}
          {editing === p.id ? (
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename();
                if (e.key === 'Escape') setEditing(null);
              }}
              onBlur={() => void commitRename()}
              className="rounded border border-border bg-surface2 px-1.5 py-0.5 text-sm"
            />
          ) : (
            <span
              className="font-medium"
              onDoubleClick={() => { setEditing(p.id); setEditName(p.name); }}
              title="Double-click to rename"
            >
              {p.name}
            </span>
          )}
          <span className="text-[10px] text-dim">{p.profile}</span>
          {p.contextId && (
            <span className="rounded bg-surface2 px-1.5 py-0.5 text-[10px] text-muted" title="Project context">
              {contextById.get(p.contextId)?.name ?? 'Archived context'}
            </span>
          )}
          {p.remote && (
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent" title="Runs on another machine over SSH">
              ⇄ {p.remote.sshTarget}
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-muted">
          {p.folderPath ?? 'no folder — chat only'}
        </div>
        <div className="mt-0.5 text-[10px] text-dim">
          {p.id !== activeId ? 'Open the project to check instruction files.' : ctx[p.id]?.length ? (
            <>
              <div>Instruction files the agent will follow:</div>
              {(ctx[p.id] ?? []).map((f) => (
                <div key={f.path} className={f.status === 'approved' ? '' : 'text-warn'}>
                  {f.path}
                  {f.status !== 'approved' && ` — ${f.status}, asks for approval at the next start`}
                  {f.lastChange && ` · ${f.lastChange}`}
                </div>
              ))}
            </>
          ) : 'no instruction files (AGENTS.md, .hermes.md, …)'}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {p.id !== activeId && (
          <button onClick={() => void setActive(p.id)} className="rounded bg-surface2 px-2 py-1 text-xs hover:bg-border">
            Open
          </button>
        )}
        <button
          onClick={() => startEdit(p)}
          className="rounded px-2 py-1 text-xs text-muted hover:text-fg"
        >
          Edit
        </button>
        <button
          onClick={() => void update(p.id, { archived: !p.archived })}
          className="rounded px-2 py-1 text-xs text-muted hover:text-fg"
        >
          {p.archived ? 'Unarchive' : 'Archive'}
        </button>
        <button
          onClick={() => void remove(p.id)}
          className="rounded px-2 py-1 text-xs text-muted hover:text-danger"
          title="Remove from app — does not delete the folder"
        >
          Remove
        </button>
      </div>
      </>}
    </li>
  );

  return (
    <div className="mx-auto mt-10 max-w-2xl px-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Projects</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setCreatingContext((v) => !v)}
            className="rounded bg-surface2 px-3 py-1.5 text-xs hover:bg-border"
          >
            {creatingContext ? 'Cancel' : '+ New context'}
          </button>
          <button
            onClick={() => setCreating((v) => !v)}
            className="rounded bg-surface2 px-3 py-1.5 text-xs hover:bg-border"
          >
            {creating ? 'Cancel' : '+ New project'}
          </button>
        </div>
      </div>

      {creatingContext && (
        <div className="mb-6 rounded-lg border border-border bg-surface p-4">
          <label className="mb-1 block text-xs text-muted">Context name</label>
          <input
            autoFocus
            value={contextName}
            onChange={(e) => setContextName(e.target.value)}
            placeholder="Acme integration"
            className="mb-3 w-full rounded border border-border bg-surface2 px-3 py-2 text-sm"
          />
          <label className="mb-1 block text-xs text-muted">
            Purser funding reference <span className="text-dim">(optional; tracking is configured later)</span>
          </label>
          <input
            value={contextFundingRef}
            onChange={(e) => setContextFundingRef(e.target.value)}
            placeholder="wallet or funding reference"
            className="mb-3 w-full rounded border border-border bg-surface2 px-3 py-2 text-sm"
          />
          {error && <p className="mb-2 text-xs text-danger">{error}</p>}
          <button
            onClick={() => void createContext()}
            disabled={!contextName.trim()}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
          >
            Create context
          </button>
        </div>
      )}

      {creating && (
        <div className="mb-6 rounded-lg border border-border bg-surface p-4">
          <label className="mb-1 block text-xs text-muted">
            Folder <span className="text-dim">(optional — required for Cowork tasks)</span>
          </label>
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
          <label className="mb-1 block text-xs text-muted">Context</label>
          <select
            value={contextId}
            onChange={(e) => setContextId(e.target.value)}
            className="mb-3 w-full rounded border border-border bg-surface2 px-3 py-2 text-sm"
          >
            <option value="">No context</option>
            {contexts.filter((context) => !context.archived).map((context) => (
              <option key={context.id} value={context.id}>{context.name}</option>
            ))}
          </select>
          <label className="mb-1 block text-xs text-muted">Purser funding reference <span className="text-dim">(optional; project overrides context)</span></label>
          <input
            value={projectFundingRef}
            onChange={(e) => setProjectFundingRef(e.target.value)}
            placeholder="wallet or funding reference"
            className="mb-3 w-full rounded border border-border bg-surface2 px-3 py-2 text-sm"
          />
          <label className="mb-1 block text-xs text-muted">Profile</label>
          {sshTarget.trim() ? (
            // Remote profiles are not in the local dashboard's list, so the
            // select would reject them — free-text instead.
            <input
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              placeholder="default"
              className="mb-3 w-full rounded border border-border bg-surface2 px-3 py-2 text-sm"
            />
          ) : (
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              className="mb-3 w-full rounded border border-border bg-surface2 px-3 py-2 text-sm"
            >
              {(profiles.length ? profiles : [profile]).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
          <label className="mb-1 block text-xs text-muted">
            Remote SSH target <span className="text-dim">(optional — [user@]host or ~/.ssh/config alias; agent runs there)</span>
          </label>
          <input
            value={sshTarget}
            onChange={(e) => setSshTarget(e.target.value)}
            placeholder="e.g. helsinki or root@192.0.2.10"
            className="mb-3 w-full rounded border border-border bg-surface2 px-3 py-2 text-sm"
          />
          {sshTarget.trim() && (
            <p className="mb-3 -mt-2 text-[10px] text-dim">
              The folder above is a path on the remote host. Files/Changes tabs are unavailable for remote tasks.
            </p>
          )}
          {error && <p className="mb-2 text-xs text-danger">{error}</p>}
          <button
            onClick={() => void create()}
            disabled={!name.trim() && !folder.trim()}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
          >
            Create project
          </button>
        </div>
      )}

      {contexts.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-dim">Contexts</div>
          <ul className="flex flex-col gap-2">
            {contexts.map((c) => (
              <li key={c.id} className={'rounded-lg border border-border bg-surface px-4 py-2 ' + (c.archived ? 'opacity-60' : '')}>
                {editingContext === c.id ? (
                  <div className="flex flex-col gap-2">
                    <input value={ctxForm.name} onChange={(e) => setCtxForm({ ...ctxForm, name: e.target.value })} placeholder="Name" className={input} />
                    <input value={ctxForm.fundingRef} onChange={(e) => setCtxForm({ ...ctxForm, fundingRef: e.target.value })} placeholder="Purser wallet / funding reference" className={input} />
                    {error && <p className="text-xs text-danger">{error}</p>}
                    <div className="flex gap-2">
                      <button onClick={() => void saveContext()} disabled={!ctxForm.name.trim()} className="rounded bg-accent px-3 py-1 text-xs font-semibold text-bg disabled:opacity-50">Save</button>
                      <button onClick={() => setEditingContext(null)} className="rounded px-3 py-1 text-xs text-muted hover:text-fg">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{c.name}</span>
                      <span className="ml-2 text-[11px] text-muted">{c.fundingRef ?? 'no funding ref'}</span>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button onClick={() => { setEditingContext(c.id); setCtxForm({ name: c.name, fundingRef: c.fundingRef ?? '' }); }} className="rounded px-2 py-1 text-xs text-muted hover:text-fg">Edit</button>
                      <button onClick={() => void window.hermes.contexts.update(c.id, { archived: !c.archived }).then(reloadContexts)} className="rounded px-2 py-1 text-xs text-muted hover:text-fg">
                        {c.archived ? 'Unarchive' : 'Archive'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {projects.length === 0 ? (
        <p className="text-sm text-muted">No projects yet. Create one from a local folder.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {live.map(row)}
          </ul>
          {archived.length > 0 && (
            <>
              <div className="mb-2 mt-6 text-[10px] uppercase tracking-wide text-dim">Archived</div>
              <ul className="flex flex-col gap-2">
                {archived.map(row)}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
