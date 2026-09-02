import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/rest-client';
import type { Status } from '../api/schemas';

export function StatusBar() {
  const [status, setStatus] = useState<Status | null>(null);
  const [stale, setStale] = useState(false);
  const [open, setOpen] = useState(false);

  const tick = useCallback(() => {
    api.status()
      .then((s) => { setStatus(s); setStale(false); })
      .catch(() => setStale(true));
  }, []);

  useEffect(() => {
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [tick]);

  return (
    <div className="relative flex items-center gap-3 border-t border-border bg-bg px-3 py-1.5 text-[11px] text-muted">
      <GatewayDot status={status} stale={stale} />
      <button
        className="ml-auto hover:text-fg"
        aria-label="Runtime status details"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {stale ? (
          <span className="text-danger">● Hermes unreachable — retry</span>
        ) : status ? (
          `hermes ${status.hermesVersion}`
        ) : (
          'connecting…'
        )}
      </button>

      {open && (
        <div className="absolute bottom-full right-2 mb-1 w-64 rounded-md border border-border bg-surface p-3 text-[11px] shadow-lg">
          <div className="mb-1 flex justify-between">
            <span className="text-dim">Hermes</span>
            <span>{status?.hermesVersion ?? '—'}</span>
          </div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-dim">Gateway</span>
            <span className="flex items-center gap-1">
              <span>{status?.gateway.running ? (status.gateway.platforms.join(', ') || 'running') : 'stopped'}</span>
              <button
                onClick={() => {
                  const act = status?.gateway.running ? 'restart' : 'start';
                  void window.hermes.rest.post(`/api/gateway/${act}`, {}).then(() => setTimeout(tick, 1500));
                }}
                className="rounded bg-surface2 px-1.5 py-0.5 text-[10px] hover:bg-border"
              >
                {status?.gateway.running ? 'restart' : 'start'}
              </button>
              {status?.gateway.running && (
                <button
                  onClick={() => void window.hermes.rest.post('/api/gateway/stop', {}).then(() => setTimeout(tick, 1500))}
                  className="rounded bg-surface2 px-1.5 py-0.5 text-[10px] hover:bg-border"
                >
                  stop
                </button>
              )}
            </span>
          </div>
          <div className="mb-2 flex justify-between">
            <span className="text-dim">Dashboard</span>
            <span className={stale ? 'text-danger' : 'text-success'}>{stale ? 'unreachable' : 'connected'}</span>
          </div>
          <button
            onClick={() => { void tick(); setOpen(false); }}
            className="w-full rounded bg-surface2 px-2 py-1 hover:bg-border"
          >
            Re-check now
          </button>
        </div>
      )}
    </div>
  );
}

function GatewayDot({ status, stale }: { status: Status | null; stale: boolean }) {
  if (stale) return <span className="flex items-center gap-1"><span className="text-danger">●</span> disconnected</span>;
  if (!status) return <span className="text-dim">● gateway: —</span>;
  const { running, platforms } = status.gateway;
  if (!running) {
    return <span className="flex items-center gap-1"><span className="text-danger">●</span> gateway: stopped</span>;
  }
  return (
    <span className="flex items-center gap-1">
      <span className="text-success">●</span>
      gateway: {platforms.join(', ') || 'idle'}
    </span>
  );
}
