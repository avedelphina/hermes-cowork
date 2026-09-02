import { useRest } from './useRest';

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-10 max-w-3xl px-6">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Err({ error }: { error: string | null }) {
  return error ? <p className="mb-3 text-xs text-danger">{error}</p> : null;
}

type Skill = { name: string; description: string; category: string | null; enabled: boolean; usage: number; provenance: string };

export function SkillsPage() {
  const { data, error, reload } = useRest<Skill[]>('/api/skills');
  const toggle = async (name: string, enabled: boolean) => {
    await window.hermes.rest.patch('/api/skills/toggle', { name, enabled: !enabled }).catch(() => {});
    reload();
  };
  return (
    <Page title="Skills">
      <Err error={error} />
      <ul className="flex flex-col gap-1 text-xs">
        {(data ?? []).map((s) => (
          <li key={s.name} className="flex items-start justify-between rounded border border-border bg-surface px-3 py-2">
            <div className="min-w-0">
              <div className="text-fg">{s.name} <span className="text-[10px] text-dim">{s.category ?? s.provenance} · used {s.usage}×</span></div>
              <div className="text-[11px] text-muted">{s.description}</div>
            </div>
            <button
              onClick={() => void toggle(s.name, s.enabled)}
              className={'ml-3 shrink-0 rounded px-2 py-0.5 text-[10px] ' + (s.enabled ? 'bg-accent text-bg' : 'bg-surface2 text-muted')}
            >
              {s.enabled ? 'on' : 'off'}
            </button>
          </li>
        ))}
      </ul>
    </Page>
  );
}

type Memory = { active: string; providers: Array<{ name: string; description: string; available: boolean; configured: boolean; status: string }> };

export function MemoryPage() {
  const { data, error } = useRest<Memory>('/api/memory');
  return (
    <Page title="Memory">
      <Err error={error} />
      <ul className="flex flex-col gap-1 text-xs">
        {(data?.providers ?? []).map((p) => (
          <li key={p.name} className="flex items-center justify-between rounded border border-border bg-surface px-3 py-2">
            <div className="min-w-0">
              <div className="text-fg">
                {p.name === data?.active && <span className="text-accent">● </span>}
                {p.name}
              </div>
              <div className="text-[11px] text-muted">{p.description}</div>
            </div>
            <span className={'ml-3 shrink-0 text-[10px] ' + (p.available ? 'text-success' : 'text-dim')}>{p.status}</span>
          </li>
        ))}
      </ul>
    </Page>
  );
}

type CronJob = { id: string; name: string; prompt: string; model: string; provider: string; schedule: { display: string } };

export function CronPage() {
  const { data, error } = useRest<CronJob[]>('/api/cron/jobs');
  return (
    <Page title="Cron jobs">
      <Err error={error} />
      <ul className="flex flex-col gap-1 text-xs">
        {(data ?? []).map((j) => (
          <li key={j.id} className="rounded border border-border bg-surface px-3 py-2">
            <div className="flex justify-between text-fg">
              <span>{j.name}</span>
              <span className="text-[10px] text-dim">{j.schedule.display} · {j.provider}/{j.model}</span>
            </div>
            <div className="mt-0.5 line-clamp-2 text-[11px] text-muted">{j.prompt}</div>
          </li>
        ))}
        {data?.length === 0 && <li className="text-muted">No cron jobs.</li>}
      </ul>
    </Page>
  );
}

type Column = { name: string; tasks: Array<{ id: string; title: string; status: string; assignee: string | null }> };

export function KanbanPage() {
  const { data, error } = useRest<{ columns: Column[] }>('/api/plugins/kanban/board');
  return (
    <Page title="Kanban">
      <Err error={error} />
      <div className="flex gap-2 overflow-x-auto">
        {(data?.columns ?? []).map((c) => (
          <div key={c.name} className="w-40 shrink-0 rounded border border-border bg-surface p-2 text-xs">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-dim">{c.name} · {c.tasks.length}</div>
            {c.tasks.map((t) => (
              <div key={t.id} className="mb-1 rounded bg-surface2 px-2 py-1 text-[11px] text-fg">
                {t.title}
                {t.assignee && <span className="block text-[9px] text-dim">👤 {t.assignee}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </Page>
  );
}

export function InsightsPage() {
  const { data, error } = useRest<Record<string, unknown>>('/api/sessions/stats');
  return (
    <Page title="Insights">
      <Err error={error} />
      <pre className="overflow-auto rounded border border-border bg-surface p-3 text-[11px] text-muted">
        {data ? JSON.stringify(data, null, 2) : '…'}
      </pre>
    </Page>
  );
}
