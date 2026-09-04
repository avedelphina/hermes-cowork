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

function notify(title: string, body: string): void {
  void window.hermes?.app?.notify({ title, body });
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
  /** The agent's current step list, from ACP `plan` updates. */
  planEntries: Array<{ content: string; status: string }>;
  planTasks: KanbanTask[];
  artifacts: Array<{ path: string; bytes?: number; addedAt: string }>;
  /** File snapshots taken just before an approved edit — for diff + revert. */
  checkpoints: Array<{ rel: string; before: string | null; at: string }>;

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
  /** Clear the transcript and mark running before an acp.load replay. */
  beginReconnect: () => void;
  addCheckpoint: (rel: string, before: string | null) => void;
  dropCheckpoint: (rel: string) => void;
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
  planEntries: [],
  planTasks: [],
  artifacts: [],
  checkpoints: [],

  startTask: ({ taskId, sessionId, goal, cwd, profile, kickoff }) =>
    set({ taskId, sessionId, goal, cwd, profile, status: 'running', approved: false, pendingKickoff: kickoff, transcript: [], approvals: [], parentTaskId: null, planEntries: [], planTasks: [], artifacts: [], checkpoints: [] }),

  restoreTask: (t) =>
    set({
      taskId: t.id, sessionId: t.acpSessionId, goal: t.goal, cwd: t.cwd, profile: t.profile,
      approved: t.approved, status: t.status === 'executing' || t.status === 'planning' ? 'running' : 'idle',
      pendingKickoff: null, filesTarget: null,
      transcript: [], approvals: [], parentTaskId: null, planEntries: [], planTasks: [], artifacts: [], checkpoints: [],
    }),

  clearKickoff: () => set({ pendingKickoff: null }),
  addCheckpoint: (rel, before) =>
    set((s) =>
      s.checkpoints.some((c) => c.rel === rel)
        ? s
        : { checkpoints: [...s.checkpoints, { rel, before, at: new Date().toISOString() }] },
    ),
  dropCheckpoint: (rel) => set((s) => ({ checkpoints: s.checkpoints.filter((c) => c.rel !== rel) })),
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

  beginReconnect: () => set({ transcript: [], approvals: [], planEntries: [], status: 'running' }),

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
    transcript: [], approvals: [], parentTaskId: null, planEntries: [], planTasks: [], artifacts: [], checkpoints: [],
  }),

  ingestAcp: (msg) =>
    set((s) => {
      // Ignore events for other ACP sessions (worker sessions, chat), and any
      // event that arrives before this task is bound to a session.
      if (!s.sessionId || msg.sessionId !== s.sessionId) return s;
      switch (msg.kind) {
        case 'token': {
          const last = s.transcript[s.transcript.length - 1];
          if (last && last.role === 'agent') {
            return { transcript: [...s.transcript.slice(0, -1), { role: 'agent', text: last.text + msg.text }] };
          }
          return { transcript: [...s.transcript, { role: 'agent', text: msg.text }] };
        }
        case 'tool-call': {
          // ACP tags file-mutating tools with kind "edit" / "delete" / "move"
          // and lists the touched files under `paths`.
          if (msg.op === 'edit' || msg.op === 'delete' || msg.op === 'move') {
            const args = (msg.args ?? {}) as { path?: string; file_path?: string; target?: string };
            const path = msg.paths[0] ?? args.path ?? args.file_path ?? args.target;
            if (path && !s.artifacts.some((a) => a.path === path)) {
              // Snapshot the pre-change file for diff + revert (fire-and-forget).
              const root = s.cwd.replace(/\/+$/, '');
              const taskId = s.taskId;
              if (taskId && root && path.startsWith(root + '/')) {
                const rel = path.slice(root.length + 1);
                void window.hermes?.fs
                  ?.snapshot(taskId, rel)
                  .then((before) => useCoworkStore.getState().addCheckpoint(rel, before))
                  .catch(() => { /* ignore */ });
              }
              return { artifacts: [...s.artifacts, { path, addedAt: new Date().toISOString() }] };
            }
          }
          return s;
        }
        case 'plan': {
          const next = msg.entries.map((e) => e.content).join(' ');
          const prev = s.planEntries.map((e) => e.content).join(' ');
          // Hermes re-plans in place after a steering message and just keeps
          // going. If the step list actually changed after the current plan
          // was approved, that new plan needs its own approval gate.
          if (s.approved && s.planEntries.length > 0 && next !== prev) {
            persistTask(s.taskId, { approved: false, status: 'awaiting_approval' });
            if (s.goal) notify('New plan ready for approval', s.goal);
            return {
              planEntries: msg.entries,
              approved: false,
              transcript: [...s.transcript, { role: 'system', text: '📋 New plan proposed — review and approve.' }],
            };
          }
          return { planEntries: msg.entries };
        }
        case 'approval-request':
          return { approvals: [...s.approvals, { toolCallId: msg.toolCallId, description: msg.description }] };
        case 'session-error':
          persistTask(s.taskId, { status: 'failed' });
          if (s.goal) notify('Cowork task failed', s.goal);
          return {
            status: 'idle',
            transcript: [...s.transcript, { role: 'system', text: `⚠️ ${msg.message}` }],
          };
        case 'done':
          persistTask(s.taskId, { status: s.approved ? 'done' : 'awaiting_approval' });
          // Only notify when the plan first lands — every executing turn also
          // ends with 'done' and there is no distinct task-complete signal.
          if (!s.approved && s.goal && s.transcript.some((m) => m.role === 'agent')) {
            notify('Plan ready for approval', s.goal);
          }
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
