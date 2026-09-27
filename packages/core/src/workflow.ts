import type { Clock, IdGenerator, TaskWorkflowRepository } from './repository';
import type { CreateTaskInput, PendingApproval, TaskRun, TaskStatus, TaskWorkflowEvent, TaskWorkflowSnapshot, WorkflowPatch, WorkflowTask } from './types';

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
    approvals: Array.isArray(snapshot.approvals) ? snapshot.approvals : [],
    runs: Array.isArray(snapshot.runs) ? snapshot.runs : [],
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

  approveDesign(id: string): WorkflowTask | null {
    const task = this.mutable(id);
    if (!task || task.status === 'done' || task.status === 'failed' || task.status === 'stopped') return null;
    task.approved = true;
    task.designApproved = true;
    task.implementationApproved = false;
    task.verificationApproved = false;
    task.status = 'executing';
    task.updatedAt = this.clock.now();
    this.emit(task, 'task-updated');
    this.persist();
    return clone(task);
  }

  rearmForPlan(id: string): WorkflowTask | null {
    const task = this.mutable(id);
    if (!task || task.status === 'done' || task.status === 'failed' || task.status === 'stopped') return null;
    task.approved = false;
    task.designApproved = false;
    task.implementationApproved = false;
    task.verificationApproved = false;
    task.status = 'awaiting_approval';
    task.updatedAt = this.clock.now();
    this.emit(task, 'task-updated');
    this.persist();
    return clone(task);
  }

  approveVerification(id: string): WorkflowTask | null {
    const task = this.mutable(id);
    if (!task || !task.designApproved || task.status === 'done' || task.status === 'failed' || task.status === 'stopped') return null;
    task.implementationApproved = true;
    task.verificationApproved = true;
    task.status = 'executing';
    task.updatedAt = this.clock.now();
    this.emit(task, 'task-updated');
    this.persist();
    return clone(task);
  }

  complete(id: string): WorkflowTask | null {
    const task = this.mutable(id);
    if (!task || !task.verificationApproved || task.status === 'done' || task.status === 'failed' || task.status === 'stopped') return null;
    task.status = 'done';
    task.updatedAt = this.clock.now();
    this.emit(task, 'task-updated');
    this.persist();
    return clone(task);
  }

  /** Existing desktop restart policy until cowork-pipe owns live execution. */
  interruptLiveTasks(): void {
    let changed = false;
    for (const task of this.snapshot.tasks) {
      if (LIVE.includes(task.status) && !task.activeRunId) {
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

  requestApproval(input: Omit<PendingApproval, 'state' | 'createdAt'> & { createdAt?: string }): PendingApproval {
    const existing = this.snapshot.approvals.find((approval) => approval.id === input.id);
    if (existing) return clone(existing);
    const approval: PendingApproval = { ...input, state: 'pending', createdAt: input.createdAt ?? this.clock.now() };
    this.snapshot.approvals.push(approval);
    this.persist();
    return clone(approval);
  }

  resolveApproval(id: string, allow: boolean, resolvedBy = 'local-user'): PendingApproval | null {
    const approval = this.snapshot.approvals.find((candidate) => candidate.id === id);
    if (!approval || approval.state !== 'pending') return approval ? clone(approval) : null;
    approval.state = 'resolved';
    approval.allow = allow;
    approval.resolvedBy = resolvedBy;
    approval.resolvedAt = this.clock.now();
    this.persist();
    return clone(approval);
  }

  expireApproval(id: string): PendingApproval | null {
    const approval = this.snapshot.approvals.find((candidate) => candidate.id === id);
    if (!approval || approval.state !== 'pending') return approval ? clone(approval) : null;
    approval.state = 'expired';
    approval.allow = false;
    approval.resolvedAt = this.clock.now();
    this.persist();
    return clone(approval);
  }

  pendingApprovals(taskId?: string): PendingApproval[] {
    return this.snapshot.approvals
      .filter((approval) => approval.state === 'pending' && (!taskId || approval.taskId === taskId))
      .map(clone);
  }

  createRun(taskId: string, acpSessionId: string | null): TaskRun | null {
    const task = this.mutable(taskId);
    if (!task || task.activeRunId) return null;
    const attempt = this.snapshot.runs.filter((run) => run.taskId === taskId).length + 1;
    const now = this.clock.now();
    const run: TaskRun = {
      id: `${taskId}:${attempt}`,
      taskId,
      attempt,
      acpSessionId,
      status: 'created',
      offset: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.snapshot.runs.push(run);
    task.activeRunId = run.id;
    task.updatedAt = now;
    this.emit(task, 'task-updated');
    this.persist();
    return clone(run);
  }

  getRun(id: string): TaskRun | null {
    const run = this.snapshot.runs.find((candidate) => candidate.id === id);
    return run ? clone(run) : null;
  }

  bindRunSession(id: string, acpSessionId: string): TaskRun | null {
    const run = this.mutableRun(id);
    if (!run || run.status !== 'created' || run.acpSessionId) return run ? clone(run) : null;
    run.acpSessionId = acpSessionId;
    run.updatedAt = this.clock.now();
    this.persist();
    return clone(run);
  }

  listRuns(taskId?: string): TaskRun[] {
    return this.snapshot.runs
      .filter((run) => !taskId || run.taskId === taskId)
      .sort((a, b) => a.attempt - b.attempt)
      .map(clone);
  }

  activeRun(taskId: string): TaskRun | null {
    const task = this.mutable(taskId);
    return task?.activeRunId ? this.getRun(task.activeRunId) : null;
  }

  attachRun(id: string): TaskRun | null {
    const run = this.mutableRun(id);
    if (!run || (run.status !== 'created' && run.status !== 'attached')) return run ? clone(run) : null;
    run.status = 'attached';
    run.updatedAt = this.clock.now();
    this.persist();
    return clone(run);
  }

  advanceRunOffset(id: string, offset: number): TaskRun | null {
    if (!Number.isSafeInteger(offset) || offset < 0) return null;
    const run = this.mutableRun(id);
    if (!run || run.status === 'finished' || run.status === 'stopped' || run.status === 'lost' || offset < run.offset) return run ? clone(run) : null;
    if (offset === run.offset) return clone(run);
    run.offset = offset;
    run.updatedAt = this.clock.now();
    this.persist();
    return clone(run);
  }

  finishRun(id: string, status: 'finished' | 'stopped' | 'lost'): TaskRun | null {
    const run = this.mutableRun(id);
    if (!run) return null;
    if (run.status === status) return clone(run);
    if (run.status === 'finished' || run.status === 'stopped' || run.status === 'lost') return clone(run);
    const now = this.clock.now();
    run.status = status;
    run.updatedAt = now;
    run.finishedAt = now;
    const task = this.mutable(run.taskId);
    if (task && task.activeRunId === run.id) {
      task.activeRunId = null;
      task.updatedAt = now;
      this.emit(task, 'task-updated');
    }
    this.persist();
    return clone(run);
  }

  stopRun(id: string): TaskRun | null {
    return this.finishRun(id, 'stopped');
  }

  private mutableRun(id: string): TaskRun | null {
    return this.snapshot.runs.find((run) => run.id === id) ?? null;
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
