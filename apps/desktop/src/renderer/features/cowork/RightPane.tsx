import { useState } from 'react';
import { PlanTab } from './PlanTab';
import { ArtifactsTab } from './ArtifactsTab';
import { SubtasksTab } from './SubtasksTab';
import { useCoworkStore, MODE_FOR } from './cowork.store';

const TABS = [
  { id: 'plan', label: 'Plan' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'subtasks', label: 'Subtasks' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function RightPane() {
  const [tab, setTab] = useState<TabId>('plan');
  const approvalMode = useCoworkStore((s) => s.approvalMode);
  const setApprovalMode = useCoworkStore((s) => s.setApprovalMode);
  const sessionId = useCoworkStore((s) => s.sessionId);

  const toggleMode = () => {
    const next = approvalMode === 'ask' ? 'auto' : 'ask';
    setApprovalMode(next);
    if (sessionId) void window.hermes.acp.setMode({ sessionId, modeId: MODE_FOR[next] });
  };

  return (
    <aside className="flex w-[280px] flex-col border-l border-border bg-surface">
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
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'plan' && <PlanTab />}
        {tab === 'artifacts' && <ArtifactsTab />}
        {tab === 'subtasks' && <SubtasksTab />}
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
