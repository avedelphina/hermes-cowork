import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../shared/types';

export function UpdateBadge() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });

  useEffect(() => {
    window.hermes.update.status().then(setStatus).catch(() => undefined);
    const off = window.hermes.update.onEvent(setStatus);
    return () => { off(); };
  }, []);

  if (status.state === 'idle' || status.state === 'checking' || status.state === 'not-available') return null;

  if (status.state === 'error') {
    return <span className="text-[11px] text-dim" title={status.message}>update check failed</span>;
  }

  if (status.state === 'available') {
    return (
      <button
        onClick={() => void window.hermes.update.download()}
        className="rounded-md bg-surface2 px-2 py-1 text-[11px] text-muted hover:text-fg"
      >
        Update v{status.version} available · Download
      </button>
    );
  }

  if (status.state === 'downloading') {
    return <span className="text-[11px] text-dim">Downloading update… {status.percent}%</span>;
  }

  // downloaded
  return (
    <button
      onClick={() => {
        if (window.confirm(`Restart to install update v${status.version}?`)) void window.hermes.update.install();
      }}
      className="rounded-md bg-accent px-2 py-1 text-[11px] text-bg hover:opacity-90"
    >
      Restart to update (v{status.version})
    </button>
  );
}
