// apps/desktop/src/main/store/task-store.ts
//
// Persistent Cowork tasks. A task is metadata around one ACP session — the
// conversation itself lives in Hermes and is replayed on resume via
// session/load, so we persist only what Hermes does not know: the goal, the
// project/profile/folder it ran in, and the plan-approval state.

import { readJson, writeJsonAtomic, pick } from './json-file';
import { randomUUID } from 'node:crypto';
import type { CoworkTask, TaskStatus } from '../../shared/types';
export type { CoworkTask, TaskStatus };

type Data = { tasks: CoworkTask[] };
type CreateInput = {
  goal: string;
  cwd: string;
  profile: string;
  acpSessionId: string;
  projectId: string | null;
  parentTaskId?: string | null;
};

// Statuses that mean "the agent was mid-flight" — if we find one at load time
// the app must have died, so it becomes 'interrupted'.
const LIVE: TaskStatus[] = ['planning', 'awaiting_approval', 'executing'];

export class TaskStore {
  private data: Data = { tasks: [] };

  constructor(private readonly filePath: string) {
    this.data = this.read();
  }

  private read(): Data {
    const parsed = (readJson(this.filePath) ?? {}) as Partial<Data>;
    const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : []).map((t) => {
      const migrated = { ...t, parentTaskId: t.parentTaskId ?? null };
      return LIVE.includes(migrated.status) ? { ...migrated, status: 'interrupted' as const } : migrated;
    });
    return { tasks };
  }

  private write(): void {
    writeJsonAtomic(this.filePath, this.data);
  }

  /** Most-recent first. */
  list(): CoworkTask[] {
    return [...this.data.tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): CoworkTask | null {
    return this.data.tasks.find((t) => t.id === id) ?? null;
  }

  create(input: CreateInput): CoworkTask {
    const now = new Date().toISOString();
    const task: CoworkTask = {
      goal: input.goal,
      cwd: input.cwd,
      profile: input.profile,
      acpSessionId: input.acpSessionId,
      projectId: input.projectId,
      parentTaskId: input.parentTaskId ?? null,
      id: randomUUID(),
      status: 'planning',
      approved: false,
      createdAt: now,
      updatedAt: now,
    };
    this.data.tasks.push(task);
    this.write();
    return task;
  }

  update(id: string, patch: Partial<Pick<CoworkTask, 'status' | 'approved'>>): CoworkTask | null {
    const task = this.get(id);
    if (!task) return null;
    Object.assign(task, pick(patch, ['status', 'approved'] as const), { updatedAt: new Date().toISOString() });
    this.write();
    return task;
  }

  remove(id: string): void {
    this.data.tasks = this.data.tasks.filter((t) => t.id !== id);
    this.write();
  }
}
