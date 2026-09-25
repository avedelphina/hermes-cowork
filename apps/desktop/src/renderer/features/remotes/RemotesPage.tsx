import { useEffect, useState } from 'react';
import type { RemoteAgent, RemoteAgentInput } from '@shared/types';
import { useRemotesStore } from './remotes.store';

type Probe = { state: 'testing' } | { state: 'ok'; ms: number } | { state: 'error'; message: string };

const now = () => Date.now(); // module level: the purity lint rule rejects Date.now() inside a component

const input = 'w-full rounded border border-border bg-surface2 px-3 py-2 text-sm focus:border-accent focus:outline-none';

/** Electron prefixes IPC errors with "Error invoking remote method '…': Error: " — drop it. */
const clean = (e: unknown) =>
  String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

export function RemotesPage() {
  const remotes = useRemotesStore((s) => s.remotes);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [sshTarget, setSshTarget] = useState('');
  const [profile, setProfile] = useState('default');
  const [hermesHome, setHermesHome] = useState('');
  const [binaryPath, setBinaryPath] = useState('');
  // Advanced deployment options — all optional.
  const [port, setPort] = useState('');
  const [identityFile, setIdentityFile] = useState('');
  const [proxyJump, setProxyJump] = useState('');
  const [runAs, setRunAs] = useState('');
  const [ctRuntime, setCtRuntime] = useState<'' | 'docker' | 'podman'>('');
  const [ctName, setCtName] = useState('');
  const [command, setCommand] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  // Profiles found on the remote by "Find profiles"; null until asked.
  const [found, setFound] = useState<string[] | null>(null);
  const [finding, setFinding] = useState(false);

  useEffect(() => { void useRemotesStore.getState().reload(); }, []);

  const load = (r: RemoteAgent | null) => {
    setEditingId(r?.id ?? null); setName(r?.name ?? ''); setSshTarget(r?.sshTarget ?? ''); setProfile(r?.profile ?? 'default');
    setHermesHome(r?.hermesHome ?? ''); setBinaryPath(r?.binaryPath ?? '');
    setPort(r?.port ? String(r.port) : ''); setIdentityFile(r?.identityFile ?? ''); setProxyJump(r?.proxyJump ?? '');
    setRunAs(r?.runAs ?? ''); setCtRuntime(r?.container?.runtime ?? ''); setCtName(r?.container?.name ?? '');
    setCommand(r?.command ?? '');
    setFound(null); setError(null);
  };
  const reset = () => load(null);
  const edit = (r: RemoteAgent) => load(r);

  // Everything the form describes, in the shape main validates.
  const origin = () => ({
    sshTarget,
    hermesHome: hermesHome.trim() || null,
    binaryPath: binaryPath.trim() || null,
    port: port.trim() ? Number(port) : null,
    identityFile: identityFile.trim() || null,
    proxyJump: proxyJump.trim() || null,
    runAs: runAs.trim() || null,
    container: ctRuntime ? { runtime: ctRuntime, name: ctName.trim() } : null,
    command: command.trim() || null,
  });

  const save = async () => {
    setError(null);
    const fields: RemoteAgentInput = { name, profile, ...origin() };
    try {
      if (editingId) await window.hermes.remotes.update(editingId, fields);
      else await window.hermes.remotes.create(fields);
      reset();
      await useRemotesStore.getState().reload();
    } catch (e) {
      setError(clean(e));
    }
  };

  const remove = async (id: string) => {
    await window.hermes.remotes.remove(id);
    if (editingId === id) reset();
    await useRemotesStore.getState().reload();
  };

  const findProfiles = async () => {
    setError(null);
    setFinding(true);
    try {
      const list = await window.hermes.remotes.profiles(origin());
      setFound(list);
      if (list.length === 0) setError('Connected, but no Hermes profiles were found there. Check the remote Hermes home.');
      else if (!list.includes(profile)) setProfile(list[0]!);
    } catch (e) {
      setFound(null);
      setError(clean(e));
    } finally {
      setFinding(false);
    }
  };

  // A real handshake: spawn the ssh child, initialize, open a session, close it.
  // Failures carry ssh's own reason (Permission denied, host key, command not found).
  const test = async (id: string, profileName: string) => {
    setProbes((p) => ({ ...p, [id]: { state: 'testing' } }));
    const t0 = now();
    let sessionId: string | null = null;
    try {
      ({ sessionId } = await window.hermes.acp.start({ profile: profileName, remoteId: id, isolate: true }));
      setProbes((p) => ({ ...p, [id]: { state: 'ok', ms: now() - t0 } }));
    } catch (e) {
      setProbes((p) => ({ ...p, [id]: { state: 'error', message: clean(e) } }));
    } finally {
      if (sessionId) void window.hermes.acp.stop(sessionId);
    }
  };

  return (
    <div className="mx-auto mt-10 max-w-2xl px-6 pb-10">
      <h2 className="mb-1 text-lg font-semibold">Remote agents</h2>
      <p className="mb-5 text-xs text-muted">
        A Hermes profile on another machine, reached over SSH. Pick one in Chat to talk to it.
        Cowork tasks always run on this computer. Needs key-based SSH (the host must already be in your
        known hosts) and Hermes installed on the remote.
      </p>

      <ul className="mb-8 flex flex-col gap-2">
        {remotes.length === 0 && <li className="text-xs text-muted">No remote agents yet.</li>}
        {remotes.map((r) => {
          const probe = probes[r.id];
          return (
            <li
              key={r.id}
              className={'rounded-lg border bg-surface px-4 py-3 ' + (editingId === r.id ? 'border-accent' : 'border-border')}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-fg">⇄ {r.name}</div>
                  <div className="truncate text-[11px] text-dim">
                    {r.profile} @ {r.sshTarget}
                    {r.container && ` · ${r.container.runtime} ${r.container.name}`}
                    {r.runAs && ` · as ${r.runAs}`}
                    {r.command && ' · custom command'}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => void test(r.id, r.profile)}
                    disabled={probe?.state === 'testing'}
                    className="rounded bg-surface2 px-2 py-1 text-xs hover:bg-border disabled:opacity-50"
                  >
                    {probe?.state === 'testing' ? 'Testing…' : 'Test connection'}
                  </button>
                  <button onClick={() => edit(r)} className="rounded px-2 py-1 text-xs text-muted hover:text-fg">
                    Edit
                  </button>
                  <button onClick={() => void remove(r.id)} className="rounded px-2 py-1 text-xs text-muted hover:text-danger">
                    Remove
                  </button>
                </div>
              </div>
              {probe?.state === 'ok' && <p className="mt-2 text-[11px] text-success">✓ Connected in {(probe.ms / 1000).toFixed(1)} s</p>}
              {probe?.state === 'error' && <p className="mt-2 break-words text-[11px] text-danger">{probe.message}</p>}
            </li>
          );
        })}
      </ul>

      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-3 text-xs font-semibold text-muted">
          {editingId ? 'Edit remote agent' : 'Add a remote agent'}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-muted">Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ocean" className={input + ' mt-1'} />
          </label>
          <label className="text-xs text-muted">SSH target
            <input
              value={sshTarget}
              onChange={(e) => { setSshTarget(e.target.value); setFound(null); }}
              placeholder="user@host or ssh alias"
              className={input + ' mt-1'}
            />
          </label>
          <label className="col-span-2 text-xs text-muted">Profile on the remote
            <div className="mt-1 flex gap-2">
              {found && found.length > 0 ? (
                <select value={profile} onChange={(e) => setProfile(e.target.value)} className={input} aria-label="Profile on the remote">
                  {(found.includes(profile) ? found : [profile, ...found]).map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              ) : (
                <input value={profile} onChange={(e) => setProfile(e.target.value)} placeholder="default" className={input} />
              )}
              <button
                onClick={() => void findProfiles()}
                disabled={!sshTarget.trim() || finding}
                className="shrink-0 rounded bg-surface2 px-3 py-2 text-xs hover:bg-border disabled:opacity-50"
                title="Connect over SSH and list the profiles on that machine"
              >
                {finding ? 'Looking…' : 'Find profiles'}
              </button>
            </div>
          </label>
          <label className="text-xs text-muted">Remote Hermes home <span className="text-dim">(optional)</span>
            <input
              value={hermesHome}
              onChange={(e) => { setHermesHome(e.target.value); setFound(null); }}
              placeholder="~/.hermes"
              className={input + ' mt-1'}
            />
          </label>
          <label className="text-xs text-muted">Remote hermes binary <span className="text-dim">(optional)</span>
            <input value={binaryPath} onChange={(e) => setBinaryPath(e.target.value)} placeholder="hermes" className={input + ' mt-1'} />
          </label>
        </div>
        <details className="mt-4 rounded border border-border px-3 py-2" open={!!(port || identityFile || proxyJump || runAs || ctRuntime || command)}>
          <summary className="cursor-pointer text-xs text-muted">Advanced deployment</summary>
          <p className="mt-2 text-[11px] text-dim">
            For hosts that need more than <code>user@host</code>. Anything an <code>~/.ssh/config</code> alias
            already sets (port, key, jump host) can go there instead.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs text-muted">SSH port
              <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" placeholder="22" className={input + ' mt-1'} />
            </label>
            <label className="text-xs text-muted">SSH key file
              <input value={identityFile} onChange={(e) => setIdentityFile(e.target.value)} placeholder="~/.ssh/id_ed25519" className={input + ' mt-1'} />
            </label>
            <label className="col-span-2 text-xs text-muted">Jump host(s) <span className="text-dim">(comma-separated, user@host[:port])</span>
              <input value={proxyJump} onChange={(e) => setProxyJump(e.target.value)} placeholder="bastion.example.com" className={input + ' mt-1'} />
            </label>
            <label className="text-xs text-muted">Run as user <span className="text-dim">(sudo -n)</span>
              <input value={runAs} onChange={(e) => setRunAs(e.target.value)} placeholder="root" className={input + ' mt-1'} />
            </label>
            <span />
            <label className="text-xs text-muted">Container runtime
              <select value={ctRuntime} onChange={(e) => setCtRuntime(e.target.value as '' | 'docker' | 'podman')} className={input + ' mt-1'}>
                <option value="">None — Hermes runs on the host</option>
                <option value="docker">docker exec</option>
                <option value="podman">podman exec</option>
              </select>
            </label>
            <label className="text-xs text-muted">Container name
              <input value={ctName} onChange={(e) => setCtName(e.target.value)} disabled={!ctRuntime} placeholder="hermes-alison" className={input + ' mt-1 disabled:opacity-50'} />
            </label>
            <label className="col-span-2 text-xs text-muted">Custom command <span className="text-dim">(replaces everything above that launches Hermes)</span>
              <textarea
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                rows={2}
                placeholder='cd /srv/hermes && exec nix-shell --run "hermes acp"'
                className={input + ' mt-1 font-mono text-xs'}
              />
              {command.trim() && (
                <span className="mt-1 block text-[11px] text-warn">
                  Runs verbatim on the remote and must speak ACP on stdin/stdout. You will be asked to confirm it when you save.
                </span>
              )}
            </label>
          </div>
        </details>
        {error && <p className="mt-3 break-words text-xs text-danger">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => void save()}
            disabled={!name.trim() || !sshTarget.trim()}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
          >
            {editingId ? 'Save changes' : 'Add'}
          </button>
          {editingId && (
            <button onClick={reset} className="rounded border border-border px-4 py-2 text-sm text-muted hover:text-fg">
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
