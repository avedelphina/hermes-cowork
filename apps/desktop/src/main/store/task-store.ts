// apps/desktop/src/main/store/task-store.ts
//
// Persistent Cowork tasks. A task is metadata around one ACP session — the
// conversation itself lives in Hermes and is replayed on resume via
// session/load, so we persist only what Hermes does not know: the goal, the
// project/profile/folder it ran in, and the plan-approval state.

import { readJson, writeJsonAtomic, pick } from './json-file';
import { randomUUID } from 'node:crypto';
import type { CoworkTask, TaskStatus, RemoteOrigin } from '../../shared/types';
export type { CoworkTask, TaskStatus };

type Data = { tasks: CoworkTask[] };
type CreateInput = {
  title: string;
  cwd: string;
  profile: string;
  projectId: string | null;
  parentTaskId?: string | null;
  remote?: RemoteOrigin | null;
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
      const migrated = {
        ...t,
        title: t.title ?? t.goal,
        acpSessionId: t.acpSessionId ?? null,
        parentTaskId: t.parentTaskId ?? null,
        designApproved: t.designApproved === true,
        implementationApproved: t.implementationApproved === true,
        verificationApproved: t.verificationApproved === true,
        remote: t.remote ?? null,
      };
      return LIVE.includes(migrated.status)
        ? { ...migrated, status: 'interrupted' as const }
        : migrated;
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
      title: input.title,
      goal: '',
      cwd: input.cwd,
      profile: input.profile,
      acpSessionId: null,
      projectId: input.projectId,
      parentTaskId: input.parentTaskId ?? null,
      designApproved: false,
      implementationApproved: false,
      verificationApproved: false,
      remote: input.remote ?? null,
      id: randomUUID(),
      status: 'draft',
      approved: false,
      createdAt: now,
      updatedAt: now,
    };
    this.data.tasks.push(task);
    this.write();
    return task;
  }

  start(id: string, acpSessionId: string): CoworkTask | null {
    const task = this.get(id);
    if (!task || task.status !== 'draft' || task.acpSessionId) return null;
    Object.assign(task, { acpSessionId, status: 'planning' as const, updatedAt: new Date().toISOString() });
    this.write();
    return task;
  }

  update(id: string, patch: Partial<Pick<CoworkTask, 'status' | 'approved' | 'designApproved' | 'implementationApproved' | 'verificationApproved'>>): CoworkTask | null {
    const task = this.get(id);
    if (!task) return null;
    Object.assign(task, pick(patch, ['status', 'approved', 'designApproved', 'implementationApproved', 'verificationApproved'] as const), { updatedAt: new Date().toISOString() });
    this.write();
    return task;
  }

  remove(id: string): void {
    this.data.tasks = this.data.tasks.filter((t) => t.id !== id);
    this.write();
  }
}
