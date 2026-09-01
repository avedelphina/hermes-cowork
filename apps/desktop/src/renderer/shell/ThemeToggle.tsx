import { useEffect, useState } from 'react';

type Mode = 'system' | 'light' | 'dark';
const KEY = 'hermes-theme';

function apply(mode: Mode) {
  const el = document.documentElement;
  if (mode === 'system') el.removeAttribute('data-theme');
  else el.dataset.theme = mode;
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : 'system';
    } catch {
      return 'system';
    }
  });

  useEffect(() => {
    apply(mode);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* private mode / storage blocked — fine, theme just won't persist */
    }
  }, [mode]);

  const next: Record<Mode, Mode> = { system: 'light', light: 'dark', dark: 'system' };
  const label: Record<Mode, string> = { system: '🖥 Auto', light: '☀ Light', dark: '🌙 Dark' };

  return (
    <button
      onClick={() => setMode((m) => next[m])}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className="rounded-md bg-surface2 px-2 py-1 text-xs text-muted hover:text-fg"
      title="Toggle light / dark / auto"
    >
      {label[mode]}
    </button>
  );
}
