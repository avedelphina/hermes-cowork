import { FileBrowser } from '../files/FileBrowser';
import { ChatSurface, useChatSurface } from '../chat/ChatSurface';
import { activeProject, useProjectStore } from '../projects/project.store';

export function CodePage() {
  useProjectStore((s) => s.activeId);
  const project = activeProject();
  const { profile, ensureSession } = useChatSurface();

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        Open a project to use Code mode.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1">
      <div className="flex w-[320px] shrink-0 flex-col border-r border-border bg-surface">
        <div className="border-b border-border px-3 py-2 text-[11px] text-muted">
          {project.name} · {project.profile}
        </div>
        <div className="min-h-0 flex-1">
          <FileBrowser />
        </div>
      </div>
      <ChatSurface profile={profile} ensureSession={ensureSession} />
    </div>
  );
}
