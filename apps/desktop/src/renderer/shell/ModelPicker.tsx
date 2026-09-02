import { useEffect, useId, useState } from 'react';
import type { AcpModels } from '@shared/types';

type Props = {
  /** Live ACP session to switch the model on. Null renders nothing. */
  sessionId: string | null;
  className?: string;
};

/**
 * Per-session model switcher. The list comes from ACP `session/new`
 * (cached main-side); resumed sessions we never saw a `session/new` for
 * have no list, so this renders nothing. Switching is a live
 * `session/set_model` and takes effect on the next turn.
 *
 * A native <datalist> gives type-to-filter over the (often 100+) model ids
 * with no combobox dependency — Electron is Chromium-only so the widget
 * behaves predictably.
 */
export function ModelPicker({ sessionId, className }: Props) {
  const [models, setModels] = useState<AcpModels | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const listId = useId();

  // Callers pass key={sessionId}, so this component remounts per session and
  // never carries a stale list — the effect only ever needs to fetch.
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    void window.hermes.acp.models(sessionId)
      .then((m) => { if (alive) { setModels(m); setDraft(m?.currentModelId ?? ''); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [sessionId]);

  if (!sessionId || !models || models.availableModels.length < 2) return null;
  const known = models.availableModels;

  const commit = async (modelId: string) => {
    // Ignore partial / unknown text — reset the field to the live model.
    if (busy || !known.some((m) => m.modelId === modelId) || modelId === models.currentModelId) {
      setDraft(models.currentModelId ?? '');
      return;
    }
    setBusy(true);
    setModels({ ...models, currentModelId: modelId }); // optimistic
    try {
      await window.hermes.acp.setModel({ sessionId, modelId });
      const fresh = await window.hermes.acp.models(sessionId);
      if (fresh) { setModels(fresh); setDraft(fresh.currentModelId ?? ''); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        type="text"
        list={listId}
        value={draft}
        disabled={busy}
        aria-label="Model"
        title="Model for this session — type to filter"
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => void commit(e.target.value.trim())}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        className={
          'w-48 rounded-md border border-border bg-surface2 px-2 py-1 text-xs text-muted hover:text-fg focus:border-accent focus:outline-none disabled:opacity-50 ' +
          (className ?? '')
        }
      />
      <datalist id={listId}>
        {known.map((m) => (
          <option key={m.modelId} value={m.modelId}>{m.name}</option>
        ))}
      </datalist>
    </>
  );
}
