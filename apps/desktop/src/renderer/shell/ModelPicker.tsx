import { useEffect, useState } from 'react';
import type { AcpModelInfo, AcpModels } from '@shared/types';

type Props = {
  /** Live ACP session to switch the model on. Null renders nothing. */
  sessionId: string | null;
  className?: string;
};

/** Hermes model ids are `provider:model`; anything without a colon has no group. */
export function groupByProvider(models: AcpModelInfo[]): Array<{ provider: string; models: AcpModelInfo[] }> {
  const groups = new Map<string, AcpModelInfo[]>();
  for (const m of models) {
    const i = m.modelId.indexOf(':');
    const provider = i > 0 ? m.modelId.slice(0, i) : '';
    groups.set(provider, [...(groups.get(provider) ?? []), m]);
  }
  return [...groups].map(([provider, list]) => ({ provider, models: list }));
}

const label = (m: AcpModelInfo) => {
  const i = m.modelId.indexOf(':');
  return i > 0 ? m.modelId.slice(i + 1) : m.name;
};

const RETRY_MS = 1500;
const MAX_TRIES = 60; // a cold Hermes start takes ~10 s; give a slow one a minute

/**
 * Per-session model switcher. The list comes from ACP `session/new` /
 * `session/load` (cached main-side). A resumed task asks for it before the
 * load has finished, so keep asking until it is there. Switching is a live
 * `session/set_model` and takes effect on the next turn.
 *
 * A native <select> grouped by provider: the earlier <datalist> filtered its
 * options by the text already in the box (the current model), so the list
 * looked like it held only that provider.
 */
export function ModelPicker({ sessionId, className }: Props) {
  const [models, setModels] = useState<AcpModels | null>(null);
  const [busy, setBusy] = useState(false);

  // Callers pass key={sessionId}, so this component remounts per session and
  // never carries a stale list — the effect only ever needs to fetch.
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const fetchModels = () => {
      window.hermes.acp.models(sessionId)
        .then((m) => {
          if (!alive) return;
          if (m) setModels(m);
          else if (++tries < MAX_TRIES) timer = setTimeout(fetchModels, RETRY_MS);
        })
        .catch(() => { if (alive && ++tries < MAX_TRIES) timer = setTimeout(fetchModels, RETRY_MS); });
    };
    fetchModels();
    return () => { alive = false; clearTimeout(timer); };
  }, [sessionId]);

  if (!sessionId || !models || !models.currentModelId) return null;
  const cls = 'w-48 rounded-md border border-border bg-surface2 px-2 py-1 text-xs text-muted ' + (className ?? '');

  // Hermes fell back to a single model: nothing to choose, but say which.
  if (models.availableModels.length < 2) {
    return <span title="Model for this session" className={cls + ' truncate'}>{models.currentModelId}</span>;
  }

  const commit = async (modelId: string) => {
    if (busy || modelId === models.currentModelId) return;
    const prev = models;
    setBusy(true);
    setModels({ ...models, currentModelId: modelId }); // optimistic
    try {
      await window.hermes.acp.setModel({ sessionId, modelId });
      const fresh = await window.hermes.acp.models(sessionId);
      if (fresh) setModels(fresh);
    } catch {
      setModels(prev); // Hermes rejected the switch — back to what was live
    } finally {
      setBusy(false);
    }
  };

  const groups = groupByProvider(models.availableModels);
  return (
    <select
      value={models.currentModelId}
      disabled={busy}
      aria-label="Model"
      title="Model for this session — type to jump"
      onChange={(e) => void commit(e.target.value)}
      className={cls + ' hover:text-fg focus:border-accent focus:outline-none disabled:opacity-50'}
    >
      {groups.map((g) => (
        <optgroup key={g.provider} label={g.provider || 'other'}>
          {g.models.map((m) => (
            <option key={m.modelId} value={m.modelId}>{label(m)}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
