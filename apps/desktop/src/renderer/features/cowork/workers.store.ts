import { create } from 'zustand';
import type { AcpServerMessage } from '@shared/types';
import { useCoworkStore } from './cowork.store';

export type Worker = {
  id: string; // persisted task id
  sessionId: string;
  goal: string;
  profile: string;
  status: 'running' | 'done' | 'failed' | 'stopped';
  output: string;
};

type WorkersStore = {
  workers: Worker[];
  add: (w: Worker) => void;
  setStatus: (id: string, status: Worker['status']) => void;
  clear: () => void;
  ingest: (msg: AcpServerMessage) => void;
};

function persist(id: string, status: Worker['status']): void {
  const map = { done: 'done', failed: 'failed', stopped: 'stopped', running: 'executing' } as const;
  void window.hermes?.tasks?.update(id, { status: map[status] });
}

export const useWorkersStore = create<WorkersStore>((set) => ({
  workers: [],
  add: (w) => set((s) => ({ workers: [...s.workers, w] })),
  setStatus: (id, status) =>
    set((s) => {
      persist(id, status);
      return { workers: s.workers.map((w) => (w.id === id ? { ...w, status } : w)) };
    }),
  clear: () => set({ workers: [] }),
  ingest: (msg) =>
    set((s) => {
      const w = s.workers.find((x) => x.sessionId === msg.sessionId);
      if (!w) return s;
      const patch = (p: Partial<Worker>) => ({ workers: s.workers.map((x) => (x.id === w.id ? { ...x, ...p } : x)) });
      switch (msg.kind) {
        case 'token':
          return msg.role === 'user' ? s : patch({ output: w.output + msg.text });
        case 'done':
          if (w.status === 'running') persist(w.id, 'done');
          return w.status === 'running' ? patch({ status: 'done' }) : s;
        case 'session-error':
          persist(w.id, 'failed');
          return patch({ status: 'failed', output: `${w.output}\n⚠️ ${msg.message}` });
        default:
          return s;
      }
    }),
}));

/** Spawn an isolated worker session under the current coordinator task. */
export async function spawnWorker(goal: string, profile: string): Promise<void> {
  const { cwd, taskId } = useCoworkStore.getState();
  if (!cwd) return;
  const { sessionId } = await window.hermes.acp.start({ profile, cwd, isolate: true });
  const task = await window.hermes.tasks.create({
    goal, cwd, profile, acpSessionId: sessionId, projectId: null, parentTaskId: taskId,
  });
  await window.hermes.tasks.update(task.id, { status: 'executing', approved: true }).catch(() => {});
  useWorkersStore.getState().add({ id: task.id, sessionId, goal, profile, status: 'running', output: '' });
  // Workers run autonomously — accept_edits still prompts for sensitive paths.
  await window.hermes.acp.setMode({ sessionId, modeId: 'accept_edits' }).catch(() => {});
  void window.hermes.acp.send({
    kind: 'prompt',
    sessionId,
    text: `You are one worker on a larger task, running in parallel with others. Do exactly this and report the result concisely when done:\n\n${goal}`,
  });
}

export function stopWorker(w: Worker): void {
  void window.hermes.acp.stop(w.sessionId);
  useWorkersStore.getState().setStatus(w.id, 'stopped');
}
