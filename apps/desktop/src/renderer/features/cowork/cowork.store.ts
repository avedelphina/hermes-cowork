// apps/desktop/src/renderer/features/cowork/cowork.store.ts
import { create } from 'zustand';
import type { AcpServerMessage, CoworkTask, TaskStatus, RemoteOrigin } from '@shared/types';
import { todoWrites, applyTodoWrite, toPlanEntries, type TodoItem } from '@shared/todos';

type Approval = { toolCallId: string; description: string };

/** Cowork approval mode → ACP session mode id. */
export const MODE_FOR = { ask: 'default', auto: 'accept_edits' } as const;

/**
 * The ACP mode the agent must actually be in. Edits are only auto-accepted
 * once the plan is approved — before that the agent runs in `default`
 * whatever the toggle says, so the plan gate does not rest on the model
 * obeying "STOP" in the prompt.
 */
export function agentModeFor(approved: boolean, mode: 'ask' | 'auto'): string {
  return approved ? MODE_FOR[mode] : MODE_FOR.ask;
}

/** Live agent state for badges: waiting on the user beats working beats idle. */
export function agentState(status: 'idle' | 'running', pendingApprovals: number): 'blocked' | 'working' | 'idle' {
  return pendingApprovals > 0 ? 'blocked' : status === 'running' ? 'working' : 'idle';
}

/** Push the effective mode to the live session (after approve, re-plan, toggle, reconnect). */
export function syncAgentMode(s: { sessionId: string | null; approved: boolean; approvalMode: 'ask' | 'auto' }): void {
  if (!s.sessionId) return;
  void window.hermes?.acp?.setMode({ sessionId: s.sessionId, modeId: agentModeFor(s.approved, s.approvalMode) })
    ?.catch(() => { /* session gone — nothing to gate */ });
}

/**
 * A path the agent touched → its path relative to the task folder, or null if
 * it lies outside it. Hermes passes whatever the model wrote, so both absolute
 * and relative paths occur.
 */
export function relInCwd(cwd: string, path: string): string | null {
  const root = cwd.replace(/\/+$/, '');
  let rel: string | null;
  if (path.startsWith('/')) rel = root && path.startsWith(root + '/') ? path.slice(root.length + 1) : null;
  else rel = path.replace(/^(\.\/)+/, '');
  return rel && !rel.split('/').includes('..') ? rel : null;
}

/** Per-task state that every start / restore / reset wipes. */
const CLEARED = {
  transcript: [] as Array<{ role: 'agent' | 'user' | 'system' | 'thought'; text: string }>,
  approvals: [] as Approval[],
  planEntries: [] as Array<{ content: string; status: string }>,
  planHistory: [] as Array<Array<{ content: string; status: string }>>,
  todoItems: [] as TodoItem[],
  nativePlan: false,
  replaying: false,
  checkpoints: [] as Array<{ rel: string; before: string | null; at: string }>,
  editCalls: [] as string[],
  changeRev: 0,
};

type PlanState = Pick<CoworkStore, 'replaying' | 'planEntries' | 'planHistory' | 'approved' | 'taskId' | 'goal' | 'sessionId' | 'approvalMode' | 'transcript'>;

/**
 * Take a new step list. Hermes re-plans in place after a steering message and
 * just keeps going, so if the step list actually changed after the current
 * plan was approved, the new plan needs its own approval gate.
 */
function withPlan(s: PlanState, entries: Array<{ content: string; status: string }>): Partial<CoworkStore> {
  const next = entries.map((e) => e.content).join(' ');
  const prev = s.planEntries.map((e) => e.content).join(' ');
  // A history replay (restore / reconnect) re-plays old re-plans; those were
  // already approved, so they must not re-arm the gate.
  if (!s.replaying && s.approved && s.planEntries.length > 0 && next !== prev) {
    persistTask(s.taskId, { approved: false, status: 'awaiting_approval' });
    syncAgentMode({ ...s, approved: false });
    if (s.goal) notify('New plan ready for approval', s.goal);
    return {
      planEntries: entries,
      planHistory: [...s.planHistory, s.planEntries],
      approved: false,
      transcript: [...s.transcript, { role: 'system', text: '📋 New plan proposed — review and approve.' }],
    };
  }
  return { planEntries: entries };
}

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
  /** Where the agent runs. Set → SSH to another host (see docs/remote-connection.md). */
  remote: RemoteOrigin | null;
  approvalMode: 'ask' | 'auto';
  /** 'running' while the agent owns the turn; 'idle' once it finishes/errors/stops. */
  status: 'idle' | 'running';
  /** false until the user approves the proposed plan. */
  approved: boolean;
  /** Kickoff prompt CoworkPage should send once its event listener is live. */
  pendingKickoff: string | null;
  /** Task-relative path the Files tab should open (set from a Changes row). */
  filesTarget: string | null;
  /** `thought` is the agent's reasoning, shown folded; `agent` is its reply. */
  transcript: Array<{ role: 'agent' | 'user' | 'system' | 'thought'; text: string }>;
  approvals: Approval[];
  /** The agent's current step list, from ACP `plan` updates. */
  planEntries: Array<{ content: string; status: string }>;
  /** Earlier plans this task had, replaced by a later re-plan — kept so nothing vanishes silently. */
  planHistory: Array<Array<{ content: string; status: string }>>;
  /** Todo list rebuilt from `todo_list` tool calls (see shared/todos.ts). */
  todoItems: TodoItem[];
  /** True from restore/reconnect until Hermes has finished replaying history. */
  replaying: boolean;
  /** True once Hermes sent a real `plan` update; the rebuilt list then stands down. */
  nativePlan: boolean;
  /** File snapshots taken just before an approved edit — for diff + revert. */
  checkpoints: Array<{ rel: string; before: string | null; at: string }>;
  /** Tool-call ids of file edits in flight; their result means the file changed on disk. */
  editCalls: string[];
  /** Bumped when files may have changed on disk, so Changes re-reads them. */
  changeRev: number;

  startTask: (input: { taskId: string; sessionId: string; goal: string; cwd: string; profile: string; remote?: RemoteOrigin | null; kickoff: string }) => void;
  /** Rehydrate from a persisted task; caller then calls acp.load to replay it. */
  restoreTask: (task: CoworkTask) => void;
  /** The acp.load history replay has finished; live events gate re-plans again. */
  endReplay: () => void;
  /** CoworkPage calls this after it has sent the kickoff. */
  clearKickoff: () => void;
  /** Ask the Files tab to open a task-relative path. */
  openInFiles: (rel: string) => void;
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
  reset: () => void;
};

export const useCoworkStore = create<CoworkStore>((set) => ({
  taskId: null,
  sessionId: null,
  goal: '',
  cwd: '',
  profile: 'default',
  remote: null,
  approvalMode: 'ask',
  status: 'idle',
  approved: false,
  pendingKickoff: null,
  filesTarget: null,
  ...CLEARED,

  startTask: ({ taskId, sessionId, goal, cwd, profile, remote, kickoff }) =>
    set({ taskId, sessionId, goal, cwd, profile, remote: remote ?? null, status: 'running', approved: false, pendingKickoff: kickoff, ...CLEARED, replaying: false }),

  restoreTask: (t) =>
    set({
      taskId: t.id, sessionId: t.acpSessionId, goal: t.goal, cwd: t.cwd, profile: t.profile,
      remote: t.remote ?? null,
      approved: t.approved, status: t.status === 'executing' || t.status === 'planning' ? 'running' : 'idle',
      pendingKickoff: null, filesTarget: null, ...CLEARED, replaying: true,
    }),

  clearKickoff: () => set({ pendingKickoff: null }),
  endReplay: () => set({ replaying: false }),
  addCheckpoint: (rel, before) =>
    set((s) =>
      s.checkpoints.some((c) => c.rel === rel)
        ? s
        : { checkpoints: [...s.checkpoints, { rel, before, at: new Date().toISOString() }] },
    ),
  dropCheckpoint: (rel) => set((s) => ({ checkpoints: s.checkpoints.filter((c) => c.rel !== rel) })),
  openInFiles: (rel) => set({ filesTarget: rel }),
  clearFilesTarget: () => set({ filesTarget: null }),
  setApprovalMode: (approvalMode) =>
    set((s) => {
      syncAgentMode({ ...s, approvalMode });
      return { approvalMode };
    }),
  approvePlan: () =>
    set((s) => {
      persistTask(s.taskId, { approved: true, status: 'executing' });
      syncAgentMode({ ...s, approved: true });
      return { approved: true, status: 'running' };
    }),

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

  beginReconnect: () => set({ transcript: [], approvals: [], planEntries: [], planHistory: [], todoItems: [], nativePlan: false, replaying: true, status: 'running' }),

  reset: () => set({
    taskId: null, sessionId: null, goal: '', cwd: '', profile: 'default', remote: null, status: 'idle', approved: false,
    pendingKickoff: null, filesTarget: null, ...CLEARED, replaying: false,
  }),

  ingestAcp: (msg) =>
    set((s) => {
      // Ignore events for other ACP sessions (worker sessions, chat), and any
      // event that arrives before this task is bound to a session.
      if (!s.sessionId || msg.sessionId !== s.sessionId) return s;
      switch (msg.kind) {
        case 'token': {
          const role = msg.thought ? 'thought' : 'agent';
          const last = s.transcript[s.transcript.length - 1];
          if (last && last.role === role) {
            return { transcript: [...s.transcript.slice(0, -1), { role, text: last.text + msg.text }] };
          }
          return { transcript: [...s.transcript, { role, text: msg.text }] };
        }
        case 'tool-call': {
          // Hermes sends no `plan` frame for `todo_list`; rebuild it from the call.
          const writes = s.nativePlan ? [] : todoWrites(msg.name, msg.args);
          if (writes.length > 0) {
            const todoItems = writes.reduce((items, w) => applyTodoWrite(items, w.todos, w.merge), s.todoItems);
            return { todoItems, ...withPlan(s, toPlanEntries(todoItems)) };
          }
          // ACP tags file-mutating tools with kind "edit" / "delete" / "move"
          // and lists the touched files under `paths`.
          if (msg.op !== 'edit' && msg.op !== 'delete' && msg.op !== 'move') return s;
          const args = (msg.args ?? {}) as { path?: string; file_path?: string; target?: string };
          const path = msg.paths[0] ?? args.path ?? args.file_path ?? args.target;
          const rel = path ? relInCwd(s.cwd, path) : null;
          if (!rel || !s.taskId) return s;
          if (!s.checkpoints.some((c) => c.rel === rel)) {
            // Main already took the checkpoint when the frame arrived; this
            // fetches it (or takes it, if main could not map the path).
            void window.hermes?.fs
              ?.checkpoint(s.taskId, rel)
              .then((before) => useCoworkStore.getState().addCheckpoint(rel, before))
              .catch(() => { /* ignore */ });
          }
          return { editCalls: [...s.editCalls, msg.toolCallId] };
        }
        case 'plan':
          return { nativePlan: true, ...withPlan(s, msg.entries) };
        case 'approval-request':
          return { approvals: [...s.approvals, { toolCallId: msg.toolCallId, description: msg.description }] };
        case 'approval-expired':
          return {
            approvals: s.approvals.filter((a) => a.toolCallId !== msg.toolCallId),
            transcript: [...s.transcript, { role: 'system', text: `⌛ Approval expired and was denied: ${msg.description}` }],
          };
        case 'session-error':
          persistTask(s.taskId, { status: 'failed' });
          if (s.goal) notify('Cowork task failed', s.goal);
          return {
            status: 'idle',
            transcript: [...s.transcript, { role: 'system', text: `⚠️ ${msg.message}` }],
          };
        case 'done':
          persistTask(s.taskId, { status: s.approved ? 'done' : 'awaiting_approval' });
          // There's no distinct "task fully complete" signal from ACP — every
          // turn (including a mid-task pause for more input) ends with 'done'.
          // Either way the ball is back in the user's court, same as the
          // idle banner in Transcript, so notify every time — the IPC side
          // already skips it while the window is focused.
          if (s.goal && s.transcript.some((m) => m.role === 'agent')) {
            notify(s.approved ? 'Hermes is waiting on you' : 'Plan ready for approval', s.goal);
          }
          return { status: 'idle', changeRev: s.changeRev + 1 };
        case 'tool-result':
          return s.editCalls.includes(msg.toolCallId) ? { changeRev: s.changeRev + 1 } : s;
        default:
          // Unknown kind: never replace state with undefined — that nukes the
          // entire store because zustand's setState replaces (not merges) when
          // the next state is non-object. See acp-translator on the main side.
          return s;
      }
    }),
}));
