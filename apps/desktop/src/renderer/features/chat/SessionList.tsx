import { useEffect } from 'react';
import { useChatsStore } from './chats.store';
import { useProjectStore } from '../projects/project.store';

export function SessionList({
  activeId,
  onPick,
  onNew,
}: {
  activeId?: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
}) {
  const chats = useChatsStore((s) => s.chats);
  const projects = useProjectStore((s) => s.projects);

  useEffect(() => {
    void useChatsStore.getState().reload();
  }, []);

  const projectName = (id: string | null) =>
    id ? (projects.find((p) => p.id === id)?.name ?? null) : null;

  return (
    <div className="flex h-full w-[260px] flex-col border-r border-border bg-surface">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-[11px] uppercase tracking-wide text-dim">Chats</span>
        <button
          onClick={onNew}
          className="rounded bg-surface2 px-2 py-0.5 text-[11px] text-fg hover:bg-border"
        >
          + New chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {chats.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted">No chats yet.</div>
        )}
        {chats.map((c) => (
          <button
            key={c.id}
            onClick={() => onPick(c.id)}
            className={
              'block w-full border-b border-border/50 px-3 py-2 text-left text-xs hover:bg-surface2 ' +
              (c.id === activeId ? 'bg-surface2' : '')
            }
          >
            <div className="truncate text-fg">{c.title ?? 'Untitled chat'}</div>
            {projectName(c.projectId) && (
              <div className="mt-0.5 text-[10px] text-dim">{projectName(c.projectId)}</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
