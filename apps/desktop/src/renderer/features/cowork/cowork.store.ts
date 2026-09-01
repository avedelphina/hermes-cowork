// apps/desktop/src/renderer/features/cowork/cowork.store.ts
import { create } from 'zustand';
import type { AcpServerMessage, CoworkTask, TaskStatus } from '@shared/types';
import type { KanbanTask } from '../../api/schemas';

type Approval = { toolCallId: string; description: string };

/** Cowork approval mode → ACP session mode id. */
export const MODE_FOR = { ask: 'default', auto: 'accept_edits' } as const;

/** Fire-and-forget persistence of a task's lifecycle state. */
function persistTask(id: string | null, patch: { status?: TaskStatus; approved?: boolean }): void {
  if (id) void window.hermes?.tasks?.update(id, patch);
}

type CoworkStore = {
  taskId: string | null;
  sessionId: string | null;
  goal: string;
  cwd: string;
  profile: string;
  approvalMode: 'ask' | 'auto';
  /** 'running' while the agent owns the turn; 'idle' once it finishes/errors/stops. */
  status: 'idle' | 'running';
  /** false until the user approves the proposed plan. */
  approved: boolean;
  /** Kickoff prompt CoworkPage should send once its event listener is live. */
  pendingKickoff: string | null;
  /** Project-relative path the Files tab should open (set by an artifact click). */
  filesTarget: string | null;
  transcript: Array<{ role: 'agent' | 'user' | 'system'; text: string }>;
  approvals: Approval[];
  parentTaskId: string | null;
  planTasks: KanbanTask[];
  artifacts: Array<{ path: string; bytes?: number; addedAt: string }>;

  startTask: (input: { taskId: string; sessionId: string; goal: string; cwd: string; profile: string; kickoff: string }) => void;
  /** Rehydrate from a persisted task; caller then calls acp.load to replay it. */
  restoreTask: (task: CoworkTask) => void;
  /** CoworkPage calls this after it has sent the kickoff. */
  clearKickoff: () => void;
  /** Ask the Files tab to open `absPath` (converted to project-relative). */
  openInFiles: (absPath: string) => void;
  clearFilesTarget: () => void;
  setApprovalMode: (m: 'ask' | 'auto') => void;
  /** User approved the proposed plan — execution may proceed. */
  approvePlan: () => void;
  /** Echo a steering/follow-up message into the transcript and mark the turn running. */
  pushUserText: (text: string) => void;
  /** User cancelled the ACP session — record it and go idle. */
  markStopped: () => void;
  ingestAcp: (msg: AcpServerMessage) => void;
  upsertPlanTask: (task: KanbanTask) => void;
  setParent: (id: string) => void;
  reset: () => void;
};

export const useCoworkStore = create<CoworkStore>((set) => ({
  taskId: null,
  sessionId: null,
  goal: '',
  cwd: '',
  profile: 'default',
  approvalMode: 'ask',
  status: 'idle',
  approved: false,
  pendingKickoff: null,
  filesTarget: null,
  transcript: [],
  approvals: [],
  parentTaskId: null,
  planTasks: [],
  artifacts: [],

  startTask: ({ taskId, sessionId, goal, cwd, profile, kickoff }) =>
    set({ taskId, sessionId, goal, cwd, profile, status: 'running', approved: false, pendingKickoff: kickoff, transcript: [], approvals: [], parentTaskId: null, planTasks: [], artifacts: [] }),

  restoreTask: (t) =>
    set({
      taskId: t.id, sessionId: t.acpSessionId, goal: t.goal, cwd: t.cwd, profile: t.profile,
      approved: t.approved, status: t.status === 'executing' || t.status === 'planning' ? 'running' : 'idle',
      pendingKickoff: null, filesTarget: null,
      transcript: [], approvals: [], parentTaskId: null, planTasks: [], artifacts: [],
    }),

  clearKickoff: () => set({ pendingKickoff: null }),
  openInFiles: (absPath) =>
    set((s) => {
      // Make it project-relative to the task folder; ignore paths outside it.
      const root = s.cwd.replace(/\/+$/, '');
      if (!root || !absPath.startsWith(root + '/')) return s;
      return { filesTarget: absPath.slice(root.length + 1) };
    }),
  clearFilesTarget: () => set({ filesTarget: null }),
  setApprovalMode: (approvalMode) => set({ approvalMode }),
  approvePlan: () =>
    set((s) => {
      persistTask(s.taskId, { approved: true, status: 'executing' });
      return { approved: true, status: 'running' };
    }),
  setParent: (parentTaskId) => set({ parentTaskId }),

  pushUserText: (text) =>
    set((s) => {
      if (s.approved) persistTask(s.taskId, { status: 'executing' });
      return { status: 'running', transcript: [...s.transcript, { role: 'user', text }] };
    }),

  markStopped: () =>
    set((s) => {
      persistTask(s.taskId, { status: 'stopped' });
      return { status: 'idle', transcript: [...s.transcript, { role: 'system', text: '⏹ Stopped by you.' }] };
    }),

  upsertPlanTask: (task) =>
    set((s) => {
      const existing = s.planTasks.find((t) => t.id === task.id);
      const list = existing
        ? s.planTasks.map((t) => (t.id === task.id ? task : t))
        : [...s.planTasks, task];
      return { planTasks: list };
    }),

  reset: () => set({
    taskId: null, sessionId: null, goal: '', cwd: '', profile: 'default', status: 'idle', approved: false,
    pendingKickoff: null, filesTarget: null,
    transcript: [], approvals: [], parentTaskId: null, planTasks: [], artifacts: [],
  }),

  ingestAcp: (msg) =>
    set((s) => {
      switch (msg.kind) {
        case 'token': {
          const last = s.transcript[s.transcript.length - 1];
          if (last && last.role === 'agent') {
            return { transcript: [...s.transcript.slice(0, -1), { role: 'agent', text: last.text + msg.text }] };
          }
          return { transcript: [...s.transcript, { role: 'agent', text: msg.text }] };
        }
        case 'tool-call': {
          // ACP tags file-mutating tools with kind "edit" / "delete" / "move".
          if (msg.op === 'edit' || msg.op === 'delete' || msg.op === 'move') {
            const args = (msg.args ?? {}) as { path?: string; file_path?: string; target?: string };
            const path = args.path ?? args.file_path ?? args.target;
            if (path && !s.artifacts.some((a) => a.path === path)) {
              return { artifacts: [...s.artifacts, { path, addedAt: new Date().toISOString() }] };
            }
          }
          return s;
        }
        case 'approval-request':
          return { approvals: [...s.approvals, { toolCallId: msg.toolCallId, description: msg.description }] };
        case 'session-error':
          persistTask(s.taskId, { status: 'failed' });
          return {
            status: 'idle',
            transcript: [...s.transcript, { role: 'system', text: `⚠️ ${msg.message}` }],
          };
        case 'done':
          persistTask(s.taskId, { status: s.approved ? 'done' : 'awaiting_approval' });
          return { status: 'idle' };
        case 'tool-result':
          return s;
        default:
          // Unknown kind: never replace state with undefined — that nukes the
          // entire store because zustand's setState replaces (not merges) when
          // the next state is non-object. See acp-translator on the main side.
          return s;
      }
    }),
}));
