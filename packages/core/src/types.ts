export type TaskStatus =
  | 'draft'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'done'
  | 'failed'
  | 'stopped'
  | 'interrupted';

export type Gate = 'design' | 'implementation' | 'verification';

export type ApprovalState = 'pending' | 'resolved' | 'expired';

export type PendingApproval = {
  id: string;
  taskId: string;
  sessionId: string;
  toolCallId: string;
  description: string;
  state: ApprovalState;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  allow?: boolean;
};

export type TaskRunStatus = 'created' | 'attached' | 'finished' | 'stopped' | 'lost';

/**
 * A durable cowork-pipe attempt. `offset` is the number of complete output
 * bytes the control plane has processed, never a frame count.
 */
export type TaskRun = {
  id: string;
  taskId: string;
  attempt: number;
  acpSessionId: string | null;
  status: TaskRunStatus;
  offset: number;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
};

/** Durable task metadata. `remote` deliberately remains transport-agnostic. */
export type WorkflowTask = {
  id: string;
  title: string;
  goal: string;
  cwd: string;
  profile: string;
  acpSessionId: string | null;
  projectId: string | null;
  parentTaskId: string | null;
  designApproved: boolean;
  implementationApproved: boolean;
  verificationApproved: boolean;
  remote: unknown | null;
  /** Local Git isolation, null when the task deliberately uses its selected folder. */
  git: { branch: string; worktreePath: string; baseRef: string } | null;
  status: TaskStatus;
  approved: boolean;
  createdAt: string;
  updatedAt: string;
  /** Monotonic sequence allocated to lifecycle events for this task. */
  eventSequence: number;
  /** Null until a durable cowork-pipe attempt is introduced. */
  activeRunId: string | null;
};

export type CreateTaskInput = {
  title: string;
  cwd: string;
  profile: string;
  projectId: string | null;
  parentTaskId?: string | null;
  remote?: unknown | null;
  git?: { branch: string; worktreePath: string; baseRef: string } | null;
};

export type TaskWorkflowEvent = {
  sequence: number;
  taskId: string;
  kind: 'task-created' | 'task-started' | 'task-updated';
  at: string;
  status: TaskStatus;
};

export type TaskWorkflowSnapshot = {
  version: 1;
  tasks: WorkflowTask[];
  events: TaskWorkflowEvent[];
  /** Durable ACP permission records. */
  approvals: PendingApproval[];
  runs: TaskRun[];
};

export type WorkflowPatch = Partial<Pick<WorkflowTask,
  'status' | 'approved' | 'designApproved' | 'implementationApproved' | 'verificationApproved'>>;
