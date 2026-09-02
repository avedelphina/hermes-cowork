import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import type { CoworkTask, TaskStatus } from '@shared/types';
import { useCoworkStore } from './cowork.store';
import { useProjectStore } from '../projects/project.store';

const STATUS_STYLE: Record<TaskStatus, string> = {
  planning: 'text-accent',
  awaiting_approval: 'text-warn',
  executing: 'text-accent',
  done: 'text-success',
  failed: 'text-danger',
  stopped: 'text-muted',
  interrupted: 'text-warn',
};
const STATUS_LABEL: Record<TaskStatus, string> = {
  planning: 'planning',
  awaiting_approval: 'needs approval',
  executing: 'running',
  done: 'done',
  failed: 'failed',
  stopped: 'stopped',
  interrupted: 'interrupted',
};

export function TasksPage() {
  const [tasks, setTasks] = useState<CoworkTask[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [projectFilter, setProjectFilter] = useState<'all' | string>('all');
  const [, navigate] = useLocation();
  const restoreTask = useCoworkStore((s) => s.restoreTask);
  const projects = useProjectStore((s) => s.projects);

  const load = () => window.hermes.tasks.list().then(setTasks).catch(() => setTasks([]));
  useEffect(() => { void load(); }, []);

  const shown = tasks.filter(
    (t) =>
      (statusFilter === 'all' || t.status === statusFilter) &&
      (projectFilter === 'all' || (t.projectId ?? '') === projectFilter),
  );
  const statuses = [...new Set(tasks.map((t) => t.status))];

  const open = (t: CoworkTask) => {
    restoreTask(t);
    navigate('/cowork');
  };

  const remove = async (id: string) => {
    await window.hermes.tasks.remove(id);
    void load();
  };

  return (
    <div className="mx-auto mt-10 max-w-2xl px-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Tasks</h2>
        <button
          onClick={() => navigate('/cowork/new')}
          className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-bg"
        >
          + New task
        </button>
      </div>

      {tasks.length > 0 && (
        <div className="mb-3 flex gap-2 text-xs">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="rounded border border-border bg-surface2 px-2 py-1"
          >
            <option value="all">All statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="rounded border border-border bg-surface2 px-2 py-1"
          >
            <option value="all">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      {tasks.length === 0 ? (
        <p className="text-sm text-muted">No tasks yet.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">No tasks match the filters.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((t) => {
            const proj = projects.find((p) => p.id === t.projectId);
            return (
              <li key={t.id} className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
                <button className="min-w-0 text-left" onClick={() => open(t)}>
                  <div className="truncate text-sm text-fg">{t.goal}</div>
                  <div className="mt-0.5 flex gap-2 text-[11px]">
                    <span className={STATUS_STYLE[t.status]}>● {STATUS_LABEL[t.status]}</span>
                    <span className="text-dim">{proj?.name ?? t.cwd}</span>
                    <span className="text-dim">{new Date(t.updatedAt).toLocaleString()}</span>
                  </div>
                </button>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => open(t)} className="rounded bg-surface2 px-2 py-1 text-xs hover:bg-border">
                    {t.status === 'interrupted' ? 'Resume' : 'Open'}
                  </button>
                  <button
                    onClick={() => void remove(t.id)}
                    className="rounded px-2 py-1 text-xs text-muted hover:text-danger"
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
