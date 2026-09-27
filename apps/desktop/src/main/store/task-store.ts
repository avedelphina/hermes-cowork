// apps/desktop/src/main/store/task-store.ts
//
// The desktop adapter persists core task workflow state to the existing local
// tasks.json file. Its restart policy remains desktop-local until cowork-pipe
// owns process lifetime.

import { randomUUID } from 'node:crypto';
import { readJson, writeJsonAtomic } from './json-file';
import {
  TaskWorkflow,
  type CreateTaskInput,
  type PendingApproval,
  type TaskRun,
  type TaskWorkflowRepository,
  type TaskWorkflowSnapshot,
  type WorkflowPatch,
  type WorkflowTask,
} from '@hermes-cowork/core';
import type { CoworkTask, TaskStatus, RemoteOrigin } from '../../shared/types';
export type { CoworkTask, TaskStatus };

type CreateInput = Omit<CreateTaskInput, 'remote'> & { remote?: RemoteOrigin | null };

type ApprovalInput = Omit<PendingApproval, 'state' | 'createdAt'> & { createdAt?: string };

function toCoworkTask(task: WorkflowTask): CoworkTask {
  return {
    id: task.id,
    title: task.title,
    goal: task.goal,
    cwd: task.cwd,
    profile: task.profile,
    acpSessionId: task.acpSessionId,
    projectId: task.projectId,
    parentTaskId: task.parentTaskId,
    designApproved: task.designApproved,
    implementationApproved: task.implementationApproved,
    verificationApproved: task.verificationApproved,
    remote: task.remote as RemoteOrigin | null,
    git: task.git,
    status: task.status,
    approved: task.approved,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

/** Local JSON repository adapter. Existing task-only files migrate additively. */
class JsonTaskRepository implements TaskWorkflowRepository {
  constructor(private readonly filePath: string) {}

  read(): TaskWorkflowSnapshot {
    const parsed = (readJson(this.filePath) ?? {}) as Partial<TaskWorkflowSnapshot>;
    return {
      version: 1,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      approvals: Array.isArray(parsed.approvals) ? parsed.approvals : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
  }

  write(snapshot: TaskWorkflowSnapshot): void {
    writeJsonAtomic(this.filePath, snapshot);
  }
}

export class TaskStore {
  private readonly workflow: TaskWorkflow;

  constructor(filePath: string) {
    this.workflow = new TaskWorkflow(
      new JsonTaskRepository(filePath),
      { now: () => new Date().toISOString() },
      { uuid: randomUUID },
    );
    // Keep current behavior honest: tasks become durable across a restart only
    // once a future cowork-pipe adapter owns their execution.
    this.workflow.interruptLiveTasks();
  }

  /** Most-recent first. */
  list(): CoworkTask[] {
    return this.workflow.list().map(toCoworkTask);
  }

  get(id: string): CoworkTask | null {
    const task = this.workflow.get(id);
    return task ? toCoworkTask(task) : null;
  }

  create(input: CreateInput): CoworkTask {
    return toCoworkTask(this.workflow.create(input));
  }

  bindGitWorkspace(id: string, git: NonNullable<CoworkTask['git']>): CoworkTask | null {
    return this.workflow.bindGitWorkspace(id, git) as CoworkTask | null;
  }

  start(id: string, acpSessionId: string): CoworkTask | null {
    const task = this.workflow.start(id, acpSessionId);
    return task ? toCoworkTask(task) : null;
  }

  approveDesign(id: string): CoworkTask | null {
    const task = this.workflow.approveDesign(id);
    return task ? toCoworkTask(task) : null;
  }

  rearmForPlan(id: string): CoworkTask | null {
    const task = this.workflow.rearmForPlan(id);
    return task ? toCoworkTask(task) : null;
  }

  approveVerification(id: string): CoworkTask | null {
    const task = this.workflow.approveVerification(id);
    return task ? toCoworkTask(task) : null;
  }

  complete(id: string): CoworkTask | null {
    const task = this.workflow.complete(id);
    return task ? toCoworkTask(task) : null;
  }

  update(id: string, patch: Partial<Pick<CoworkTask, 'status' | 'approved' | 'designApproved' | 'implementationApproved' | 'verificationApproved'>>): CoworkTask | null {
    const task = this.workflow.patch(id, patch satisfies WorkflowPatch);
    return task ? toCoworkTask(task) : null;
  }

  createRun(taskId: string, acpSessionId: string | null): TaskRun | null {
    return this.workflow.createRun(taskId, acpSessionId);
  }

  attachRun(id: string): TaskRun | null {
    return this.workflow.attachRun(id);
  }

  advanceRunOffset(id: string, offset: number): TaskRun | null {
    return this.workflow.advanceRunOffset(id, offset);
  }

  finishRun(id: string, status: 'finished' | 'stopped' | 'lost'): TaskRun | null {
    return this.workflow.finishRun(id, status);
  }

  stopRun(id: string): TaskRun | null {
    return this.workflow.stopRun(id);
  }

  getRun(id: string): TaskRun | null {
    return this.workflow.getRun(id);
  }

  activeRun(taskId: string): TaskRun | null {
    return this.workflow.activeRun(taskId);
  }

  /**
   * Preserve a piped run's durable identity when ACP assigns its session id
   * after the pipe has already been created.
   */
  bindRunSession(id: string, acpSessionId: string): TaskRun | null {
    return this.workflow.bindRunSession(id, acpSessionId);
  }

  requestApproval(input: ApprovalInput): PendingApproval {
    return this.workflow.requestApproval(input);
  }

  resolveApproval(id: string, allow: boolean, resolvedBy?: string): PendingApproval | null {
    return this.workflow.resolveApproval(id, allow, resolvedBy);
  }

  expireApproval(id: string): PendingApproval | null {
    return this.workflow.expireApproval(id);
  }

  remove(id: string): void {
    this.workflow.remove(id);
  }
}
