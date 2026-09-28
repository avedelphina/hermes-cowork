import { Link, useLocation } from 'wouter';

type Item = { icon: string; label: string; href: string };

const COWORK_ITEMS: Item[] = [
  { icon: '+', label: 'New task', href: '/cowork/new' },
  { icon: '⏵', label: 'Current task', href: '/cowork' },
  { icon: '☰', label: 'Tasks', href: '/cowork/tasks' },
  { icon: '📁', label: 'Projects', href: '/cowork/projects' },
  { icon: '⚙', label: 'Settings', href: '/settings' },
];

const HERMES_ITEMS: Item[] = [
  { icon: '⇄', label: 'Remote agents', href: '/remotes' },
  { icon: '📋', label: 'Kanban', href: '/kanban' },
  { icon: '🧠', label: 'Memory', href: '/memory' },
  { icon: '🪛', label: 'Skills', href: '/skills' },
  { icon: '⏰', label: 'Cron', href: '/cron' },
  { icon: '📊', label: 'Insights', href: '/insights' },
];

export function Sidebar() {
  const [location] = useLocation();
  return (
    <aside aria-label="Navigation" className="flex w-[220px] flex-col border-r border-border bg-surface px-2 py-3 text-sm">
      <Section title="Cowork" items={COWORK_ITEMS} active={location} />
      <div className="my-3 border-t border-border" />
      <Section title="Hermes" items={HERMES_ITEMS} active={location} />
      <div className="mt-auto px-2 pt-4 text-[10px] text-dim">⌘1 Chat · ⌘2 Cowork</div>
    </aside>
  );
}

function Section({ title, items, active }: { title: string; items: Item[]; active: string }) {
  return (
    <div>
      <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-dim">{title}</div>
      {items.map((it) => {
        const isActive = active === it.href;
        return (
          <Link
            key={it.href}
            href={it.href}
            className={
              'flex items-center gap-2 rounded-lg px-2 py-1.5 ' +
              (isActive ? 'bg-accent/10 font-medium text-accent' : 'text-muted hover:bg-surface2 hover:text-fg')
            }
          >
            <span aria-hidden className="w-5 text-center text-[15px] leading-none opacity-80">{it.icon}</span>
            <span>{it.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
