import { Link, useLocation } from 'wouter';

const TABS = [
  { id: 'chat', label: 'Chat', href: '/chat' },
  { id: 'cowork', label: 'Cowork', href: '/cowork' },
] as const;

export function ModeTabs() {
  const [location] = useLocation();
  return (
    <nav aria-label="Mode" className="flex items-center justify-center border-b border-border bg-surface px-3 py-1.5">
      <div className="flex rounded-lg bg-surface2 p-0.5">
        {TABS.map((t) => {
          const active = location.startsWith(t.href);
          return (
            <Link
              key={t.id}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={
                'rounded-md px-3 py-1 text-sm transition-colors ' +
                (active
                  ? 'bg-accent text-white font-semibold shadow-sm'
                  : 'text-muted hover:bg-surface2')
              }
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
