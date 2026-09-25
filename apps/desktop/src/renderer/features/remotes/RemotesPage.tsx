import { useEffect, useState } from 'react';
import { useRemotesStore } from './remotes.store';

type Probe = { state: 'testing' } | { state: 'ok'; ms: number } | { state: 'error'; message: string };

const now = () => Date.now(); // module level: the purity lint rule rejects Date.now() inside a component

const input = 'w-full rounded border border-border bg-surface2 px-3 py-2 text-sm focus:border-accent focus:outline-none';

export function RemotesPage() {
  const remotes = useRemotesStore((s) => s.remotes);
  const [name, setName] = useState('');
  const [sshTarget, setSshTarget] = useState('');
  const [profile, setProfile] = useState('default');
  const [hermesHome, setHermesHome] = useState('');
  const [binaryPath, setBinaryPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, Probe>>({});

  useEffect(() => { void useRemotesStore.getState().reload(); }, []);

  const add = async () => {
    setError(null);
    try {
      await window.hermes.remotes.create({
        name, sshTarget, profile,
        hermesHome: hermesHome.trim() || null, binaryPath: binaryPath.trim() || null,
      });
      setName(''); setSshTarget(''); setProfile('default'); setHermesHome(''); setBinaryPath('');
      await useRemotesStore.getState().reload();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''));
    }
  };

  const remove = async (id: string) => {
    await window.hermes.remotes.remove(id);
    await useRemotesStore.getState().reload();
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
      const message = String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
      setProbes((p) => ({ ...p, [id]: { state: 'error', message } }));
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
            <li key={r.id} className="rounded-lg border border-border bg-surface px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-fg">⇄ {r.name}</div>
                  <div className="truncate text-[11px] text-dim">{r.profile} @ {r.sshTarget}</div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => void test(r.id, r.profile)}
                    disabled={probe?.state === 'testing'}
                    className="rounded bg-surface2 px-2 py-1 text-xs hover:bg-border disabled:opacity-50"
                  >
                    {probe?.state === 'testing' ? 'Testing…' : 'Test connection'}
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
        <div className="mb-3 text-xs font-semibold text-muted">Add a remote agent</div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-muted">Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ocean" className={input + ' mt-1'} />
          </label>
          <label className="text-xs text-muted">SSH target
            <input value={sshTarget} onChange={(e) => setSshTarget(e.target.value)} placeholder="user@host or ssh alias" className={input + ' mt-1'} />
          </label>
          <label className="text-xs text-muted">Profile on the remote
            <input value={profile} onChange={(e) => setProfile(e.target.value)} placeholder="default" className={input + ' mt-1'} />
          </label>
          <span />
          <label className="text-xs text-muted">Remote Hermes home <span className="text-dim">(optional)</span>
            <input value={hermesHome} onChange={(e) => setHermesHome(e.target.value)} placeholder="~/.hermes" className={input + ' mt-1'} />
          </label>
          <label className="text-xs text-muted">Remote hermes binary <span className="text-dim">(optional)</span>
            <input value={binaryPath} onChange={(e) => setBinaryPath(e.target.value)} placeholder="hermes" className={input + ' mt-1'} />
          </label>
        </div>
        {error && <p className="mt-3 text-xs text-danger">{error}</p>}
        <button
          onClick={() => void add()}
          disabled={!name.trim() || !sshTarget.trim()}
          className="mt-4 rounded bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
