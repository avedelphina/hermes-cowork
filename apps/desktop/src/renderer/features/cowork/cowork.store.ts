// apps/desktop/src/renderer/features/cowork/cowork.store.ts
import { create } from 'zustand';
import type { AcpServerMessage, CoworkTask, TaskStatus, RemoteOrigin } from '@shared/types';
import { todoWrites, applyTodoWrite, toPlanEntries, type TodoItem } from '@shared/todos';

type Approval = { toolCallId: string; description: string };

type ActivityEntry = {
  at: string;
  label: string;
  detail?: string;
  count?: number;
  firstAt?: string;
};

export type EvidenceState = 'verified' | 'observed' | 'claimed' | 'failed' | 'stale';
export type EvidenceItem = {
  id: string;
  at: string;
  state: EvidenceState;
  label: string;
  detail?: string;
  /** Paths are only task-relative, so Evidence never expands filesystem scope. */
  paths?: string[];
};

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
  currentActivity: null as string | null,
  activity: [] as ActivityEntry[],
  seenEventIds: [] as number[],
  evidence: [] as EvidenceItem[],
  advisor: { sessionId: null, modelId: null, status: 'idle' as const, transcript: [] as Array<{ role: 'agent' | 'user' | 'system'; text: string }> },
  advisorError: null as string | null,
};

type PlanState = Pick<CoworkStore, 'replaying' | 'planEntries' | 'planHistory' | 'approved' | 'designApproved' | 'implementationApproved' | 'verificationApproved' | 'taskId' | 'goal' | 'sessionId' | 'approvalMode' | 'transcript'>;

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
    persistTask(s.taskId, {
      approved: false,
      designApproved: false,
      implementationApproved: false,
      verificationApproved: false,
      status: 'awaiting_approval',
    });
    syncAgentMode({ ...s, approved: false });
    if (s.goal) notify('New plan ready for approval', s.goal);
    return {
      planEntries: entries,
      planHistory: [...s.planHistory, s.planEntries],
      approved: false,
      designApproved: false,
      implementationApproved: false,
      verificationApproved: false,
      transcript: [...s.transcript, { role: 'system', text: '📋 New plan proposed — review and approve.' }],
    };
  }
  if (!s.replaying && s.designApproved && s.planEntries.length > 0 && entries.every((e) => e.status === 'completed') && !s.implementationApproved) {
    return { planEntries: entries, status: 'idle' };
  }
  if (!s.replaying && s.verificationApproved && s.planEntries.length > 0 && entries.every((e) => e.status === 'completed')) {
    persistTask(s.taskId, { status: 'done' });
    return { planEntries: entries, status: 'idle' };
  }
  return { planEntries: entries };
}
/** Fire-and-forget persistence of a task's lifecycle state. */
function persistTask(id: string | null, patch: { status?: TaskStatus; approved?: boolean; designApproved?: boolean; implementationApproved?: boolean; verificationApproved?: boolean }): void {
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
  git: CoworkTask['git'];
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
  /** Human-readable activity derived only from observed ACP events. */
  currentActivity: string | null;
  /** Recent observed operations, newest first. */
  activity: Array<{ at: string; label: string; detail?: string; count?: number; firstAt?: string }>;
  /** Main-process journal ids already applied, preventing replay duplication. */
  seenEventIds: number[];
  /** Bounded proof records derived from ACP events, not assistant prose. */
  evidence: EvidenceItem[];
  /** Read-only external consultation, never merged into the task transcript. */
  advisor: { sessionId: string | null; modelId: string | null; status: 'idle' | 'running' | 'done' | 'failed'; transcript: Array<{ role: 'agent' | 'user' | 'system'; text: string }> };
  advisorError: string | null;
  askAdvisor: () => Promise<void>;
  startTask: (input: { taskId: string; sessionId: string; goal: string; cwd: string; profile: string; remote?: RemoteOrigin | null; kickoff: string }) => void;
  bindSession: (sessionId: string) => void;
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
  /** True after the design stage has been approved; implementation must not run before this. */
  designApproved: boolean;
  /** True after implementation is complete and the user approves verification. */
  implementationApproved: boolean;
  verificationApproved: boolean;
  /** User approved the proposed plan — execution may proceed. */
  approvePlan: () => void;
  /** Approve the completed implementation and allow verification/finalisation. */
  approveImplementation: () => void;
  approveVerification: () => void;
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
  git: null,
  approvalMode: 'ask',
  status: 'idle',
  approved: false,
  pendingKickoff: null,
  filesTarget: null,
  designApproved: false,
  implementationApproved: false,
  verificationApproved: false,
  ...CLEARED,

  startTask: ({ taskId, sessionId, goal, cwd, profile, remote, kickoff }) =>
    set({ taskId, sessionId, goal, cwd, profile, remote: remote ?? null, git: null, status: 'running', approved: false, pendingKickoff: kickoff, ...CLEARED, replaying: false }),

  bindSession: (sessionId) => set({ sessionId, status: 'running', approved: false }),

  restoreTask: (t) =>
    set({
      taskId: t.id, sessionId: t.acpSessionId, goal: t.title || t.goal, cwd: t.cwd, profile: t.profile,
      remote: t.remote ?? null, git: t.git ?? null,
      approved: t.approved, designApproved: t.designApproved, implementationApproved: t.implementationApproved,
      verificationApproved: t.verificationApproved, status: t.status === 'executing' || t.status === 'planning' ? 'running' : 'idle',
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
      persistTask(s.taskId, { approved: true, designApproved: true, status: 'executing' });
      syncAgentMode({ ...s, approved: true });
      return { approved: true, designApproved: true, status: 'running' };
    }),
  approveImplementation: () =>
    set((s) => {
      persistTask(s.taskId, { implementationApproved: true, status: 'executing' });
      return { implementationApproved: true, status: 'running' };
    }),

  approveVerification: () =>
    set((s) => {
      persistTask(s.taskId, { implementationApproved: true, verificationApproved: true, status: 'executing' });
      return { implementationApproved: true, verificationApproved: true, status: 'running' };
    }),

  askAdvisor: async () => {
    const s = useCoworkStore.getState();
    if (!s.sessionId || s.status !== 'idle' || s.advisor.status === 'running') return;
    const advisor = { sessionId: null as string | null, modelId: null as string | null, status: 'running' as const, transcript: [] as Array<{ role: 'agent' | 'user' | 'system'; text: string }> };
    set({ advisor, advisorError: null });
    try {
      const result = await window.hermes.acp.start({ profile: s.profile, cwd: s.cwd, isolate: true });
      advisor.sessionId = result.sessionId;
      set({ advisor: { ...advisor, sessionId: result.sessionId } });
      const models = await window.hermes.acp.models(result.sessionId);
      const model = models?.availableModels.find((m) => /claude|sonnet|opus|reason|strong/i.test(`${m.modelId} ${m.name}`));
      if (model) {
        await window.hermes.acp.setModel({ sessionId: result.sessionId, modelId: model.modelId });
        set({ advisor: { ...useCoworkStore.getState().advisor, modelId: model.modelId } });
      }
      const transcript = s.transcript.map((m) => `${m.role}: ${m.text}`).join('\n').slice(-12_000);
      const prompt = [
        'You are a read-only advisor reviewing a separate Hermes Cowork task.',
        'Do not edit files, run commands, or change the task.',
        'Review the task and current transcript, then provide concise advice for the user.',
        '',
        `Task: ${s.goal.trim() || '(no task goal recorded)'}`,
        '',
        'Current transcript:',
        transcript || '(no transcript yet)',
      ].join('\n');
      const off = window.hermes.acp.onEvent((msg) => {
        if (msg.sessionId !== result.sessionId) return;
        if (msg.kind === 'token') {
          const current = useCoworkStore.getState().advisor;
          const last = current.transcript.at(-1);
          const transcript = last?.role === 'agent'
            ? [...current.transcript.slice(0, -1), { role: 'agent' as const, text: last.text + msg.text }]
            : [...current.transcript, { role: 'agent' as const, text: msg.text }];
          set({ advisor: { ...current, transcript } });
        } else if (msg.kind === 'done') {
          off();
          set({ advisor: { ...useCoworkStore.getState().advisor, status: 'done' } });
          void window.hermes.acp.stop(result.sessionId);
        } else if (msg.kind === 'session-error') {
          off();
          set({ advisor: { ...useCoworkStore.getState().advisor, status: 'failed' }, advisorError: msg.message });
        }
      });
      await window.hermes.acp.send({ kind: 'prompt', sessionId: result.sessionId, text: prompt });
    } catch (err) {
      set({ advisor: { ...advisor, status: 'failed' }, advisorError: String(err) });
    }
  },

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
    taskId: null, sessionId: null, goal: '', cwd: '', profile: 'default', remote: null, git: null, status: 'idle', approved: false,
    designApproved: false, implementationApproved: false, verificationApproved: false,
    pendingKickoff: null, filesTarget: null, ...CLEARED, replaying: false,
  }),

  ingestAcp: (msg) =>
    set((s) => {
      // Ignore events for other ACP sessions (worker sessions, chat), and any
      // event that arrives before this task is bound to a session.
      if (!s.sessionId || msg.sessionId !== s.sessionId) return s;
      if (typeof msg.eventId === 'number' && s.seenEventIds.includes(msg.eventId)) return s;
      const seenEventIds = typeof msg.eventId === 'number'
        ? [...s.seenEventIds, msg.eventId].slice(-500)
        : s.seenEventIds;
      const record = (label: string, detail?: string): Partial<CoworkStore> => {
        const entry: ActivityEntry = { at: new Date().toISOString(), label, ...(detail ? { detail } : {}) };
        const repetitive = label === 'Responding' || label === 'Waiting for you';
        const last = s.activity[0];
        if (repetitive && last?.label === label && !last.detail) {
          const collapsed = { ...last, count: (last.count ?? 1) + 1, firstAt: last.firstAt ?? last.at, at: entry.at };
          return { currentActivity: label, activity: [collapsed, ...s.activity.slice(1)], seenEventIds };
        }
        return { currentActivity: label, activity: [entry, ...s.activity].slice(0, 20), seenEventIds };
      };
      const evidence = (state: EvidenceState, label: string, detail?: string, paths?: string[]): Partial<CoworkStore> => ({
        evidence: [{ id: `${msg.eventId ?? `${msg.kind}:${Date.now()}`}`, at: new Date().toISOString(), state, label, ...(detail ? { detail } : {}), ...(paths?.length ? { paths } : {}) }, ...s.evidence].slice(0, 100),
      });
      switch (msg.kind) {
        case 'token': {
          const role = msg.thought ? 'thought' : 'agent';
          const last = s.transcript[s.transcript.length - 1];
          if (last && last.role === role) {
            return { transcript: [...s.transcript.slice(0, -1), { role, text: last.text + msg.text }], ...record(msg.thought ? 'Thinking' : 'Responding') };
          }
          return { transcript: [...s.transcript, { role, text: msg.text }], ...record(msg.thought ? 'Thinking' : 'Responding') };
        }
        case 'tool-call': {
          // Hermes sends no `plan` frame for `todo_list`; rebuild it from the call.
          const writes = s.nativePlan ? [] : todoWrites(msg.name, msg.args);
          if (writes.length > 0) {
            const todoItems = writes.reduce((items, w) => applyTodoWrite(items, w.todos, w.merge), s.todoItems);
            return { todoItems, ...withPlan(s, toPlanEntries(todoItems)), ...record('Updating plan') };
          }
          // ACP tags file-mutating tools with kind "edit" / "delete" / "move"
          // and lists the touched files under `paths`.
          if (msg.op !== 'edit' && msg.op !== 'delete' && msg.op !== 'move') return { ...s, ...record(`${msg.name}`, msg.op) };
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
          return { editCalls: [...s.editCalls, msg.toolCallId], ...record(msg.name, `${msg.op}${path ? ` · ${path}` : ''}`), ...evidence('observed', 'File change requested', msg.name, [rel]) };
        }
        case 'plan':
          return { nativePlan: true, ...withPlan(s, msg.entries), ...record('Plan updated') };
        case 'approval-request':
          return { approvals: [...s.approvals, { toolCallId: msg.toolCallId, description: msg.description }], ...record('Waiting for approval', msg.description) };
        case 'approval-expired':
          return {
            approvals: s.approvals.filter((a) => a.toolCallId !== msg.toolCallId),
            transcript: [...s.transcript, { role: 'system', text: `⌛ Approval expired and was denied: ${msg.description}` }],
            ...record('Approval expired', msg.description),
          };
        case 'session-error':
          persistTask(s.taskId, { status: 'failed' });
          if (s.goal) notify('Cowork task failed', s.goal);
          return {
            status: 'idle',
            transcript: [...s.transcript, { role: 'system', text: `⚠️ ${msg.message}` }],
            ...record('Failed', msg.message),
            ...evidence('failed', 'Session failed', msg.message),
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
          return { status: 'idle', changeRev: s.changeRev + 1, ...record('Waiting for you') };
        case 'tool-result':
          return s.editCalls.includes(msg.toolCallId)
            ? {
                changeRev: s.changeRev + 1,
                editCalls: s.editCalls.filter((id) => id !== msg.toolCallId),
                ...record('Tool finished'),
                ...evidence('verified', 'File change completed', `Tool ${msg.toolCallId}`),
              }
            : { ...s, ...record('Tool finished') };
        default:
          // Unknown kind: never replace state with undefined — that nukes the
          // entire store because zustand's setState replaces (not merges) when
          // the next state is non-object. See acp-translator on the main side.
          return s;
      }
    }),
}));
