import { create } from 'zustand';
import type { AcpServerMessage } from '@shared/types';
import { useCoworkStore } from './cowork.store';

export type WorkerStatus = 'queued' | 'running' | 'done' | 'failed' | 'stopped';

export type Worker = {
  id: string; // persisted task id
  sessionId: string | null; // null while queued
  goal: string;
  profile: string;
  dependsOn: string[]; // worker ids that must finish first
  status: WorkerStatus;
  output: string;
};

export type WorkerPolicy = {
  maxConcurrent: number;
  timeoutSec: number;
};

type WorkersStore = {
  workers: Worker[];
  policy: WorkerPolicy;
  setPolicy: (patch: Partial<WorkerPolicy>) => void;
  /** Queue a worker; it starts when its deps are done and a slot is free. */
  enqueue: (goal: string, profile: string, dependsOn: string[]) => void;
  stop: (id: string) => void;
  clear: () => void;
  ingest: (msg: AcpServerMessage) => void;
};

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const localId = () => `w-${Math.random().toString(36).slice(2, 10)}`;

function persist(id: string, status: WorkerStatus): void {
  if (id.startsWith('w-')) return; // still a local id — not persisted yet
  const map = { queued: 'planning', running: 'executing', done: 'done', failed: 'failed', stopped: 'stopped' } as const;
  void window.hermes?.tasks?.update(id, { status: map[status] });
}

export const useWorkersStore = create<WorkersStore>((set, get) => {
  /** Start any queued worker whose deps are satisfied and a slot is free. */
  const pump = () => {
    const { workers, policy } = get();
    let running = workers.filter((w) => w.status === 'running').length;
    const done = new Set(workers.filter((w) => w.status === 'done').map((w) => w.id));

    for (const w of workers) {
      if (w.status !== 'queued') continue;
      if (running >= policy.maxConcurrent) break;
      if (!w.dependsOn.every((d) => done.has(d))) continue;
      running++;
      void startWorker(w.id);
    }
  };

  const startWorker = async (id: string) => {
    const w = get().workers.find((x) => x.id === id);
    if (!w || w.status !== 'queued') return;
    const { cwd, taskId } = useCoworkStore.getState();
    if (!cwd) return;

    try {
      const { sessionId } = await window.hermes.acp.start({ profile: w.profile, cwd, isolate: true });
      const task = await window.hermes.tasks.create({
        goal: w.goal, cwd, profile: w.profile, acpSessionId: sessionId,
        projectId: null, parentTaskId: taskId,
      });
      await window.hermes.tasks.update(task.id, { status: 'executing', approved: true }).catch(() => {});
      // Swap the local id for the persisted task id, mark running.
      set((s) => ({
        workers: s.workers.map((x) =>
          x.id === id ? { ...x, id: task.id, sessionId, status: 'running' as const } : x,
        ),
      }));
      // Fix up any dependsOn that referenced the local id.
      set((s) => ({
        workers: s.workers.map((x) => ({
          ...x,
          dependsOn: x.dependsOn.map((d) => (d === id ? task.id : d)),
        })),
      }));

      await window.hermes.acp.setMode({ sessionId, modeId: 'accept_edits' }).catch(() => {});
      void window.hermes.acp.send({
        kind: 'prompt',
        sessionId,
        text: `You are one worker on a larger task, running in parallel with others. Do exactly this and report the result concisely when done:\n\n${w.goal}`,
      });

      const ms = get().policy.timeoutSec * 1000;
      timers.set(task.id, setTimeout(() => get().stop(task.id), ms));
    } catch (err) {
      set((s) => ({
        workers: s.workers.map((x) =>
          x.id === id ? { ...x, status: 'failed' as const, output: `⚠️ ${String(err)}` } : x,
        ),
      }));
    }
  };

  const finish = (id: string, status: WorkerStatus, extra = '') => {
    const t = timers.get(id);
    if (t) { clearTimeout(t); timers.delete(id); }
    persist(id, status);
    set((s) => ({
      workers: s.workers.map((w) => (w.id === id ? { ...w, status, output: w.output + extra } : w)),
    }));
    pump();
  };

  return {
    workers: [],
    policy: { maxConcurrent: 2, timeoutSec: 300 },

    setPolicy: (patch) => set((s) => ({ policy: { ...s.policy, ...patch } })),

    enqueue: (goal, profile, dependsOn) => {
      set((s) => ({
        workers: [
          ...s.workers,
          { id: localId(), sessionId: null, goal, profile, dependsOn, status: 'queued', output: '' },
        ],
      }));
      pump();
    },

    stop: (id) => {
      const w = get().workers.find((x) => x.id === id);
      if (!w || (w.status !== 'running' && w.status !== 'queued')) return;
      if (w.sessionId) void window.hermes.acp.stop(w.sessionId);
      finish(id, 'stopped');
    },

    clear: () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      set({ workers: [] });
    },

    ingest: (msg) => {
      const w = get().workers.find((x) => x.sessionId && x.sessionId === msg.sessionId);
      if (!w) return;
      if (msg.kind === 'token') {
        if (msg.role === 'user') return;
        set((s) => ({ workers: s.workers.map((x) => (x.id === w.id ? { ...x, output: x.output + msg.text } : x)) }));
      } else if (msg.kind === 'done') {
        if (w.status === 'running') finish(w.id, 'done');
      } else if (msg.kind === 'session-error') {
        if (w.status === 'running') finish(w.id, 'failed', `\n⚠️ ${msg.message}`);
      }
    },
  };
});
