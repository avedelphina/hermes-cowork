import { Link } from 'wouter';
import { ProfileDropdown } from './ProfileDropdown';
import { ThemeToggle } from './ThemeToggle';
import { activeProject, useProjectStore } from '../features/projects/project.store';

export function TitleBar() {
  useProjectStore((s) => s.activeId); // re-render on project switch
  const project = activeProject();
  return (
    <div
      className="flex items-center gap-3 border-b border-border bg-bg px-3"
      style={{ height: 38, WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} className="ml-16 flex items-center gap-2">
        <ProfileDropdown />
        <Link
          href="/cowork/projects"
          className="rounded-md bg-surface2 px-3 py-1 text-xs text-muted hover:text-fg"
          title={project?.folderPath ?? undefined}
        >
          📁 {project?.name ?? 'No project'}
        </Link>
      </div>
      <div className="ml-auto" />
      <ThemeToggle />
    </div>
  );
}
