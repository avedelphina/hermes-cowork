import { useEffect, useState } from 'react';
import type { CoworkSettings } from '@shared/types';

const DEFAULTS: CoworkSettings = { defaultFundingRef: null, trackChatsByDefault: false };

export function SettingsPage() {
  const [settings, setSettings] = useState<CoworkSettings>(DEFAULTS);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.hermes.settings.get().then(setSettings).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const save = async () => {
    setError(null);
    try {
      const next = await window.hermes.settings.update(settings);
      setSettings(next);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mx-auto mt-10 max-w-2xl px-6">
      <h2 className="mb-1 text-lg font-semibold">Settings</h2>
      <p className="mb-6 text-sm text-muted">Optional Purser attribution. Credentials and budget decisions remain in Purser.</p>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-3 text-sm font-medium">Purser tracking</h3>
        <label className="mb-1 block text-xs text-muted">Default funding reference</label>
        <input
          value={settings.defaultFundingRef ?? ''}
          onChange={(e) => setSettings((current) => ({ ...current, defaultFundingRef: e.target.value || null }))}
          placeholder="wallet or funding reference"
          className="mb-2 w-full rounded border border-border bg-surface2 px-3 py-2 text-sm"
        />
        <p className="mb-4 text-[11px] text-dim">Projects can override this. Contexts supply the next fallback. This reference does not grant spending authority.</p>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.trackChatsByDefault}
            onChange={(e) => setSettings((current) => ({ ...current, trackChatsByDefault: e.target.checked }))}
            className="mt-0.5"
          />
          <span>
            Track new chats by default
            <span className="mt-0.5 block text-[11px] text-dim">Off by default. When enabled, new chats may use the default funding reference once Purser delivery is configured.</span>
          </span>
        </label>

        {error && <p className="mt-3 text-xs text-danger">{error}</p>}
        <div className="mt-4 flex items-center gap-3">
          <button onClick={() => void save()} className="rounded bg-accent px-4 py-2 text-sm font-semibold text-bg">Save settings</button>
          {saved && <span className="text-xs text-muted">Saved</span>}
        </div>
      </section>
    </div>
  );
}
