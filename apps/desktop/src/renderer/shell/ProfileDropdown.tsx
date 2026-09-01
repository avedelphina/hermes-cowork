import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { api } from '../api/rest-client';
import type { ProfileSummary } from '../api/schemas';

type Load =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; profiles: ProfileSummary[] };

export function ProfileDropdown() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [env, setEnv] = useState<{ globalHermesHome: string; envProfile: string | null } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.profiles()
      .then((profiles) => setLoad({ state: 'ready', profiles }))
      .catch(() => setLoad({ state: 'error' }));
    window.hermes.profile.env().then(setEnv).catch(() => setEnv(null));
  }, []);

  const profiles = load.state === 'ready' ? load.profiles : [];
  const active = profiles.find((p) => p.active);
  // Only fall back to the HERMES_HOME hint once Hermes itself has answered and
  // reported no active profile — never guess "default" during load.
  const label =
    load.state === 'loading' ? '…'
    : load.state === 'error' ? 'unknown'
    : active?.name ?? env?.envProfile ?? 'default';
  const activePath = active?.hermesHome ?? (env?.envProfile ? undefined : env?.globalHermesHome);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md bg-surface2 px-3 py-1 text-xs"
        title={activePath}
        aria-label="Profile menu"
        aria-expanded={open}
      >
        <span
          className={
            'h-1.5 w-1.5 rounded-full ' +
            (load.state === 'ready' ? 'bg-accent' : load.state === 'error' ? 'bg-danger' : 'bg-dim')
          }
        />
        <strong>{label}</strong>
        <span className="text-dim">▼</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-64 rounded-md border border-border bg-surface p-1 shadow-lg">
          {load.state === 'error' && (
            <p className="px-2 py-1.5 text-xs text-danger">Could not reach Hermes.</p>
          )}
          {load.state === 'ready' && profiles.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted">No profiles reported.</p>
          )}
          {profiles.map((p) => (
            <button
              key={p.name}
              onClick={() => {
                void (async () => {
                  await window.hermes.profile.switch(p.name);
                  setOpen(false);
                  location.reload();
                })();
              }}
              className={
                'flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left text-xs ' +
                (p.active ? 'bg-surface2 text-fg' : 'text-muted hover:text-fg')
              }
            >
              <span className="flex items-center gap-2">
                <span className={p.active ? 'text-accent' : 'text-dim'}>●</span>
                {p.name}
              </span>
              <span className="truncate pl-4 text-[10px] text-dim">
                {[p.provider, p.model].filter(Boolean).join(' · ') || p.hermesHome}
              </span>
            </button>
          ))}
          <Link
            href="/profiles"
            onClick={() => setOpen(false)}
            className="mt-1 block border-t border-border px-2 py-1.5 text-xs text-muted hover:text-fg"
          >
            Manage profiles…
          </Link>
        </div>
      )}
    </div>
  );
}
