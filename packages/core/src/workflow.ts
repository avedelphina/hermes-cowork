import type { Clock, IdGenerator, TaskWorkflowRepository } from './repository';
import type { CreateTaskInput, TaskStatus, TaskWorkflowEvent, TaskWorkflowSnapshot, WorkflowPatch, WorkflowTask } from './types';

const LIVE: readonly TaskStatus[] = ['planning', 'awaiting_approval', 'executing'];

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalise(snapshot: Partial<TaskWorkflowSnapshot>): TaskWorkflowSnapshot {
  return {
    version: 1,
    tasks: (Array.isArray(snapshot.tasks) ? snapshot.tasks : []).map((task) => ({
      ...task,
      title: task.title ?? task.goal,
      acpSessionId: task.acpSessionId ?? null,
      parentTaskId: task.parentTaskId ?? null,
      designApproved: task.designApproved === true,
      implementationApproved: task.implementationApproved === true,
      verificationApproved: task.verificationApproved === true,
      remote: task.remote ?? null,
      git: task.git ?? null,
      eventSequence: task.eventSequence ?? 0,
      activeRunId: task.activeRunId ?? null,
    })),
    events: Array.isArray(snapshot.events) ? snapshot.events : [],
  };
}

/**
 * The durable, client-independent authority for named Cowork tasks.
 * It owns only lifecycle metadata: ACP transport, plan rendering and filesystem
 * scope remain adapters around this core.
 */
export class TaskWorkflow {
  private snapshot: TaskWorkflowSnapshot;

  constructor(
    private readonly repository: TaskWorkflowRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    this.snapshot = normalise(repository.read());
  }

  list(): WorkflowTask[] {
    return [...this.snapshot.tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(clone);
  }

  get(id: string): WorkflowTask | null {
    const task = this.snapshot.tasks.find((candidate) => candidate.id === id);
    return task ? clone(task) : null;
  }

  create(input: CreateTaskInput): WorkflowTask {
    const now = this.clock.now();
    const task: WorkflowTask = {
      id: this.ids.uuid(),
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
      git: input.git ?? null,
      status: 'draft',
      approved: false,
      createdAt: now,
      updatedAt: now,
      eventSequence: 0,
      activeRunId: null,
    };
    this.snapshot.tasks.push(task);
    this.emit(task, 'task-created');
    this.persist();
    return clone(task);
  }

  bindGitWorkspace(id: string, git: NonNullable<WorkflowTask['git']>): WorkflowTask | null {
    const task = this.mutable(id);
    if (!task || task.status !== 'draft' || task.git) return null;
    task.git = clone(git);
    task.cwd = git.worktreePath;
    task.updatedAt = this.clock.now();
    this.emit(task, 'task-updated');
    this.persist();
    return clone(task);
  }

  start(id: string, acpSessionId: string): WorkflowTask | null {
    const task = this.mutable(id);
    if (!task || task.status !== 'draft' || task.acpSessionId) return null;
    task.acpSessionId = acpSessionId;
    task.status = 'planning';
    task.updatedAt = this.clock.now();
    this.emit(task, 'task-started');
    this.persist();
    return clone(task);
  }

  /**
   * Compatibility-only patch authority for the desktop migration. This is
   * deliberately narrow; lifecycle commands will replace it as each UI action
   * moves to core.
   */
  patch(id: string, patch: WorkflowPatch): WorkflowTask | null {
    const task = this.mutable(id);
    if (!task) return null;
    const allowed: WorkflowPatch = {
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.approved === undefined ? {} : { approved: patch.approved }),
      ...(patch.designApproved === undefined ? {} : { designApproved: patch.designApproved }),
      ...(patch.implementationApproved === undefined ? {} : { implementationApproved: patch.implementationApproved }),
      ...(patch.verificationApproved === undefined ? {} : { verificationApproved: patch.verificationApproved }),
    };
    if (allowed.status !== undefined && !this.canSetStatus(task.status, allowed.status)) return null;
    Object.assign(task, allowed, { updatedAt: this.clock.now() });
    this.emit(task, 'task-updated');
    this.persist();
    return clone(task);
  }

  /** Existing desktop restart policy until cowork-pipe owns live execution. */
  interruptLiveTasks(): void {
    let changed = false;
    for (const task of this.snapshot.tasks) {
      if (LIVE.includes(task.status)) {
        task.status = 'interrupted';
        task.updatedAt = this.clock.now();
        this.emit(task, 'task-updated');
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  remove(id: string): void {
    const before = this.snapshot.tasks.length;
    this.snapshot.tasks = this.snapshot.tasks.filter((task) => task.id !== id);
    if (this.snapshot.tasks.length !== before) this.persist();
  }

  eventsAfter(taskId: string, sequence: number): TaskWorkflowEvent[] {
    return this.snapshot.events.filter((event) => event.taskId === taskId && event.sequence > sequence).map(clone);
  }

  private mutable(id: string): WorkflowTask | null {
    return this.snapshot.tasks.find((task) => task.id === id) ?? null;
  }

  private canSetStatus(current: TaskStatus, next: TaskStatus): boolean {
    if (current === next) return true;
    // The desktop TaskUpdate IPC is still a compatibility adapter during this
    // first extraction. It may restore a legacy record directly into any live
    // or terminal state; core's command API will replace that escape hatch as
    // individual lifecycle operations migrate.
    if (current === 'done' || current === 'failed' || current === 'stopped') return false;
    return true;
  }

  private emit(task: WorkflowTask, kind: TaskWorkflowEvent['kind']): void {
    task.eventSequence += 1;
    this.snapshot.events.push({ sequence: task.eventSequence, taskId: task.id, kind, at: task.updatedAt, status: task.status });
  }

  private persist(): void {
    this.repository.write(clone(this.snapshot));
  }
}
