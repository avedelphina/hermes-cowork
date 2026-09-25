import { useState } from 'react';
import { PlanTab } from './PlanTab';
import { ChangesTab } from './ChangesTab';
import { FileBrowser } from '../files/FileBrowser';
import { useCoworkStore } from './cowork.store';

const TABS = [
  { id: 'plan', label: 'Plan' },
  { id: 'files', label: 'Files' },
  { id: 'changes', label: 'Changes' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const MIN_W = 300;
const MAX_W = 800;
const WIDTH_KEY = 'cowork.rightPaneWidth';

function initialWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return n >= MIN_W && n <= MAX_W ? n : 340;
  } catch {
    return 340;
  }
}

export function RightPane() {
  const [tab, setTab] = useState<TabId>('plan');
  const [width, setWidth] = useState(initialWidth);
  const changed = useCoworkStore((s) => s.checkpoints.length);
  const planEntries = useCoworkStore((s) => s.planEntries);
  const planDone = planEntries.filter((e) => e.status === 'completed').length;
  const badge: Partial<Record<TabId, string>> = {
    plan: planEntries.length ? `${planDone}/${planEntries.length}` : '',
    changes: changed ? String(changed) : '',
  };

  // Drag the left edge to resize; the width sticks across sessions.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let w = startW;
    const move = (ev: PointerEvent) => {
      w = Math.min(MAX_W, Math.max(MIN_W, startW + startX - ev.clientX));
      setWidth(w);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try { localStorage.setItem(WIDTH_KEY, String(w)); } catch { /* not persisted */ }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const approvalMode = useCoworkStore((s) => s.approvalMode);
  const setApprovalMode = useCoworkStore((s) => s.setApprovalMode);

  // setApprovalMode pushes the effective ACP mode (still `default` until the
  // plan is approved).
  const toggleMode = () => setApprovalMode(approvalMode === 'ask' ? 'auto' : 'ask');

  return (
    <aside style={{ width }} className="relative flex shrink-0 flex-col border-l border-border bg-surface">
      <div
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize side panel"
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-accent/30"
      />
      <div className="flex border-b border-border text-[11px]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              'px-3 py-2.5 ' +
              (tab === t.id
                ? 'border-b-2 border-accent bg-bg text-accent'
                : 'text-muted hover:text-fg')
            }
          >
            {t.label}
            {badge[t.id] && <span className="ml-1 text-[10px] text-dim">{badge[t.id]}</span>}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === 'plan' && <div className="overflow-y-auto"><PlanTab /></div>}
        {tab === 'files' && <FileBrowser />}
        {tab === 'changes' && <div className="overflow-y-auto"><ChangesTab onOpenFile={() => setTab('files')} /></div>}
      </div>
      <div className="border-t border-border p-3 text-[11px]">
        <div className="mb-2 text-[9px] uppercase tracking-wide text-dim">Mode</div>
        <button onClick={toggleMode} className="flex items-center gap-2">
          <span
            className={
              'inline-flex h-3.5 w-6 items-center rounded-full p-0.5 ' +
              (approvalMode === 'ask' ? 'justify-end bg-accent' : 'justify-start bg-surface2')
            }
          >
            <span className="h-2.5 w-2.5 rounded-full bg-fg" />
          </span>
          <span>{approvalMode === 'ask' ? 'Ask before acting' : 'Act without asking'}</span>
        </button>
      </div>
    </aside>
  );
}
