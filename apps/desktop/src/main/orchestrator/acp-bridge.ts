// apps/desktop/src/main/orchestrator/acp-bridge.ts
//
// High-level ACP session manager. Owns:
//  - A pool of `hermes acp` connections, one per (profile, hermesHome). The
//    Python process cold-starts in ~3s (plugin/MCP/memory discovery), so a
//    connection is initialized once and then reused for every session/new,
//    session/load and session/prompt — resuming a past session drops from a
//    full respawn to ~0.4s.
//  - The acp-sessionId ↔ connection-handle mapping (many sessions per handle).
//  - Pending session/request_permission state, so renderer-side approve/deny
//    can be turned into JSON-RPC responses to the original request.
//  - Translation of incoming server-pushed events → semantic AcpServerMessage.
//  - Emitting `'done'` when our session/prompt request gets a response.
//
// Wire format reference: ACP protocol v1, verified against Hermes 0.20.6
// (see acp-translator and docs/acp-notes.md).

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AcpSupervisor, AcpEvent } from './acp-supervisor';
import type { AcpServerMessage, AcpModels, AcpModelInfo, AcpPromptAttachment, RemoteOrigin } from '../../shared/types';
import { translateAcpEvent } from './acp-translator';
import { TokenCoalescer } from './token-coalescer';

const ACP_PROTOCOL_VERSION = 1;
const INITIALIZE_PARAMS = {
  protocolVersion: ACP_PROTOCOL_VERSION,
  clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  clientInfo: { name: 'hermes-cowork-desktop', version: '0.2.0' },
};
/** Ceiling for control requests (handshake, session/new|load, set_mode|model).
 * session/prompt is unbounded — a turn legitimately runs for minutes. */
const CONTROL_TIMEOUT_MS = 120_000;
/** A permission request must fail closed rather than leave an agent blocked indefinitely. */
export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

type StartSessionOpts = {
  profile: string;
  cwd: string;
  binaryPath: string;
  hermesHome: string;
  /** Reach the agent over SSH instead of spawning locally. */
  remote?: RemoteOrigin | null;
  /** Give this session its own ACP child (not the shared pool). */
  isolate?: boolean;
  /** Main-process-derived, Hermes-allowlisted request attribution. Never renderer input. */
  requestHeaders?: Record<string, string>;
  /** Attach this isolated task session through cowork-pipe. */
  pipe?: {
    scriptPath: string;
    runId: string;
    offset: number;
    onOffset?: (offset: number) => void;
    onExit?: (code: number | null, expected: boolean) => void;
  };
};

type PermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

type PermissionOption = {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
};

type PendingPermission = {
  approvalId: string;
  taskId: string | null;
  sessionId: string;
  toolCallId: string;
  handle: string;
  requestId: string | number;
  options: PermissionOption[];
  description: string;
  timer: ReturnType<typeof setTimeout>;
};

type ApprovalStore = {
  requestApproval(input: {
    id: string;
    taskId: string;
    sessionId: string;
    toolCallId: string;
    description: string;
  }): { state: 'pending' | 'resolved' | 'expired'; allow?: boolean };
  resolveApproval(id: string, allow: boolean, resolvedBy?: string): { state: 'pending' | 'resolved' | 'expired'; allow?: boolean } | null;
  expireApproval(id: string): { state: 'pending' | 'resolved' | 'expired'; allow?: boolean } | null;
};

type Conn = { handle: string; ready: Promise<void> };

/** Coerce the ACP `models` blob into our shape, or null if it is unusable. */
function normalizeModels(raw: unknown): AcpModels | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { currentModelId?: unknown; availableModels?: unknown };
  const list = Array.isArray(r.availableModels) ? r.availableModels : [];
  const availableModels: AcpModelInfo[] = list
    .map((m): AcpModelInfo | null => {
      if (!m || typeof m !== 'object') return null;
      const o = m as { modelId?: unknown; name?: unknown; description?: unknown };
      if (typeof o.modelId !== 'string') return null;
      return {
        modelId: o.modelId,
        name: typeof o.name === 'string' ? o.name : o.modelId,
        ...(typeof o.description === 'string' ? { description: o.description } : {}),
      };
    })
    .filter((m): m is AcpModelInfo => m !== null);
  if (availableModels.length === 0) return null;
  return {
    currentModelId: typeof r.currentModelId === 'string' ? r.currentModelId : null,
    availableModels,
  };
}

function optionalUsageToken(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function parseTurnUsage(raw: unknown): Omit<Extract<AcpServerMessage, { kind: 'turn-usage' }>, 'kind' | 'sessionId'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const usage = raw as Record<string, unknown>;
  const inputTokens = usage['inputTokens'];
  const outputTokens = usage['outputTokens'];
  const totalTokens = usage['totalTokens'];
  if (typeof inputTokens !== 'number' || !Number.isSafeInteger(inputTokens) || inputTokens < 0 ||
    typeof outputTokens !== 'number' || !Number.isSafeInteger(outputTokens) || outputTokens < 0 ||
    typeof totalTokens !== 'number' || !Number.isSafeInteger(totalTokens) || totalTokens < 0) return null;
  const reasoningTokens = optionalUsageToken(usage['thoughtTokens']);
  const cachedReadTokens = optionalUsageToken(usage['cachedReadTokens']);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(cachedReadTokens === undefined ? {} : { cachedReadTokens }),
  };
}

export class AcpBridge extends EventEmitter {
  private acpToHandle = new Map<string, string>();
  /** Task ownership binds a live ACP permission to its durable core record. */
  private taskBySession = new Map<string, string>();
  /** Model state as reported by session/new (and session/load when present). */
  private modelsBySession = new Map<string, AcpModels>();
  private pendingPermissions = new Map<string, PendingPermission>();
  private approvalStore: ApprovalStore | null = null;
  /** One warm ACP connection per profile + home + remote identity (host, remote home, remote binary). */
  private conns = new Map<string, Conn>();
  /** Handles spawned for a single isolated session — safe to hard-kill. */
  private isolatedHandles = new Set<string>();
  /** Sessions mid-`session/load` → handle. Their replay frames arrive before
   * the load response binds them, so ownership must already hold. */
  private loading = new Map<string, string>();
  /** Bounded semantic-event journal for renderer remounts/reconnects. */
  private eventSeq = 0;
  private readonly journal = new Map<string, AcpServerMessage[]>();
  private tokens = new TokenCoalescer((m) => this.emitJournal(m));

  constructor(private readonly sup: AcpSupervisor, approvalStore?: ApprovalStore) {
    super();
    this.approvalStore = approvalStore ?? null;
    this.sup.on('event', this.onSupervisorEvent);
  }

  /**
   * Point an ACP session at `handle`. If it was previously served by a
   * *different isolated* child (e.g. CoworkPage re-loaded the task on a
   * remount, spawning a fresh child each time), shut the old one down — an
   * orphaned child keeps receiving Hermes' broadcast of every session on the
   * HERMES_HOME and its events would double up in the renderer.
   */
  private bindSession(sessionId: string, handle: string): void {
    const prev = this.acpToHandle.get(sessionId);
    if (prev && prev !== handle && this.isolatedHandles.has(prev)) {
      this.isolatedHandles.delete(prev);
      this.sup.shutdown(prev);
    }
    this.acpToHandle.set(sessionId, handle);
  }

  /**
   * Open a new Hermes session. Reuses the warm connection for the profile,
   * unless `isolate` asks for a dedicated child.
   */
  async startSession(opts: StartSessionOpts): Promise<{ sessionId: string }> {
    const handle = opts.isolate ? await this.spawnDedicated(opts) : await this.connFor(opts);
    try {
      const res = (await this.sup.request(handle, 'session/new', {
        cwd: opts.cwd,
        mcpServers: [],
        ...(opts.requestHeaders && Object.keys(opts.requestHeaders).length > 0
          ? { _meta: { hermes: { requestHeaders: opts.requestHeaders } } }
          : {}),
      }, CONTROL_TIMEOUT_MS)) as { sessionId?: string; models?: unknown };
      if (typeof res?.sessionId !== 'string') throw new Error('session/new returned no sessionId');
      this.bindSession(res.sessionId, handle);
      const models = normalizeModels(res.models);
      if (models) this.modelsBySession.set(res.sessionId, models);
      return { sessionId: res.sessionId };
    } catch (err) {
      if (opts.isolate) {
        this.isolatedHandles.delete(handle);
        this.sup.shutdown(handle);
      }
      throw err;
    }
  }

  /** Set the ACP session mode (default | accept_edits | dont_ask). */
  async setMode(sessionId: string, modeId: string): Promise<void> {
    const handle = this.acpToHandle.get(sessionId);
    if (!handle) throw new Error(`unknown ACP session ${sessionId}`);
    await this.sup.request(handle, 'session/set_mode', { sessionId, modeId }, CONTROL_TIMEOUT_MS);
  }

  /** Whether this desktop process is already attached to an ACP session. */
  hasSession(sessionId: string): boolean {
    return this.acpToHandle.has(sessionId);
  }

  /** Return and clear events emitted while the renderer was not mounted. */
  drainEvents(sessionId: string): AcpServerMessage[] {
    const events = this.journal.get(sessionId) ?? [];
    this.journal.delete(sessionId);
    return events;
  }

  /** Cached model state for a session, or null if we never saw session/new for it. */
  getModels(sessionId: string): AcpModels | null {
    return this.modelsBySession.get(sessionId) ?? null;
  }

  /** Switch the model for a live session (ACP `session/set_model`). */
  async setModel(sessionId: string, modelId: string): Promise<void> {
    const handle = this.acpToHandle.get(sessionId);
    if (!handle) throw new Error(`unknown ACP session ${sessionId}`);
    await this.sup.request(handle, 'session/set_model', { sessionId, modelId }, CONTROL_TIMEOUT_MS);
    const cur = this.modelsBySession.get(sessionId);
    if (cur) this.modelsBySession.set(sessionId, { ...cur, currentModelId: modelId });
  }

  private async spawnDedicated(opts: StartSessionOpts): Promise<string> {
    const handle = randomUUID();
    this.isolatedHandles.add(handle);
    this.sup.spawn({
      id: handle,
      profile: opts.profile,
      cwd: opts.cwd,
      binaryPath: opts.binaryPath,
      hermesHome: opts.hermesHome,
      remote: opts.remote ?? null,
      ...(opts.pipe === undefined ? {} : { pipe: opts.pipe }),
    });
    try {
      await this.sup.request(handle, 'initialize', INITIALIZE_PARAMS, CONTROL_TIMEOUT_MS);
    } catch (err) {
      this.isolatedHandles.delete(handle);
      this.sup.shutdown(handle);
      throw err;
    }
    return handle;
  }

  /**
   * Resume an existing Hermes session by id. Per ACP, session/load takes the
   * id we already hold and its response carries no sessionId — the agent just
   * replays the conversation as session/update notifications during the call.
   */
  async loadSession(opts: StartSessionOpts & { sessionId: string }): Promise<{ sessionId: string }> {
    const handle = opts.isolate ? await this.spawnDedicated(opts) : await this.connFor(opts);
    this.loading.set(opts.sessionId, handle);
    try {
      const res = (await this.sup.request(handle, 'session/load', {
        sessionId: opts.sessionId,
        cwd: opts.cwd,
        mcpServers: [],
        ...(opts.requestHeaders && Object.keys(opts.requestHeaders).length > 0
          ? { _meta: { hermes: { requestHeaders: opts.requestHeaders } } }
          : {}),
      }, CONTROL_TIMEOUT_MS)) as { models?: unknown } | null;
      this.bindSession(opts.sessionId, handle);
      const models = normalizeModels(res?.models);
      if (models) this.modelsBySession.set(opts.sessionId, models);
      return { sessionId: opts.sessionId };
    } catch (err) {
      if (opts.isolate) {
        this.isolatedHandles.delete(handle);
        this.sup.shutdown(handle);
      }
      throw err;
    } finally {
      if (this.loading.get(opts.sessionId) === handle) this.loading.delete(opts.sessionId);
      this.tokens.flush(opts.sessionId); // replay tail must land before load resolves
    }
  }

  /** Get (or lazily create + initialize) the pooled connection for a profile. */
  private async connFor(opts: StartSessionOpts): Promise<string> {
    // The SSH target is part of the identity: a local `anikke` and a remote
    // `anikke` must never share a child.
    const r = opts.remote;
    const key = [opts.profile, opts.hermesHome, r?.sshTarget ?? '', r?.hermesHome ?? '', r?.binaryPath ?? ''].join('\0');
    let conn = this.conns.get(key);
    if (!conn) {
      const handle = randomUUID();
      this.sup.spawn({
        id: handle,
        profile: opts.profile,
        cwd: opts.cwd,
        binaryPath: opts.binaryPath,
        hermesHome: opts.hermesHome,
        remote: opts.remote ?? null,
      });
      const ready = this.sup
        .request(handle, 'initialize', INITIALIZE_PARAMS, CONTROL_TIMEOUT_MS)
        .then(() => undefined)
        .catch((err) => {
          // Bad handshake — drop the dead conn so the next call respawns.
          this.conns.delete(key);
          this.sup.shutdown(handle);
          throw err;
        });
      conn = { handle, ready };
      this.conns.set(key, conn);
    }
    await conn.ready;
    return conn.handle;
  }

  /**
   * Send a user prompt and emit `'done'` when the agent finishes its turn.
   * Throws if Hermes rejects the prompt; caller (IPC handler) surfaces the
   * error to the renderer. `'done'` is emitted in either case so the UI can
   * stop showing a loading indicator.
   */
  async sendPrompt(sessionId: string, text: string, attachments: AcpPromptAttachment[] = []): Promise<void> {
    const handle = this.acpToHandle.get(sessionId);
    if (!handle) throw new Error(`unknown ACP session ${sessionId}`);
    const cleanText = text.trim();
    if (!cleanText && attachments.length === 0) throw new Error('prompt must contain text or an attachment');

    // A prompt sent while another is in flight is mid-turn: Hermes absorbs it
    // (/steer redirects the running turn, /queue runs it after) and answers at
    // once, so it must not end the turn the UI is still showing as working.
    const midTurn = (this.promptsInFlight.get(sessionId) ?? 0) > 0;
    this.promptsInFlight.set(sessionId, (this.promptsInFlight.get(sessionId) ?? 0) + 1);
    try {
      // Slash commands are text-only for Hermes, so attachments go as a plain prompt.
      const wireText = midTurn && attachments.length === 0 && !cleanText.startsWith('/')
        ? `/${this.midTurnSend()} ${cleanText}`
        : cleanText;
      const prompt: Array<Record<string, string>> = wireText ? [{ type: 'text', text: wireText }] : [];
      for (const attachment of attachments) {
        if (attachment.mimeType.startsWith('image/')) {
          prompt.push({ type: 'image', data: attachment.data, mimeType: attachment.mimeType });
        } else {
          prompt.push({ type: 'text', text: `Attached file: ${attachment.name}\n${attachment.data}` });
        }
      }
      const result = (await this.sup.request(handle, 'session/prompt', {
        sessionId,
        prompt,
      })) as { usage?: unknown } | null;
      const usage = parseTurnUsage(result?.usage);
      if (usage && !midTurn) this.out({ kind: 'turn-usage', sessionId, ...usage });
    } finally {
      const left = (this.promptsInFlight.get(sessionId) ?? 1) - 1;
      if (left > 0) this.promptsInFlight.set(sessionId, left);
      else this.promptsInFlight.delete(sessionId);
      if (!midTurn) this.out({ kind: 'done', sessionId });
    }
  }

  /** Source of the mid-turn send mode (a Cowork setting); defaults to steer. */
  setMidTurnSend(get: () => 'steer' | 'queue'): void {
    this.midTurnSend = get;
  }

  private promptsInFlight = new Map<string, number>();
  private midTurnSend: () => 'steer' | 'queue' = () => 'steer';

  setApprovalStore(store: ApprovalStore): void {
    this.approvalStore = store;
  }

  /** Bind a Cowork task to its live ACP session; only task-bound sessions
   * create durable permission records. */
  bindTaskSession(taskId: string, sessionId: string): void {
    this.taskBySession.set(sessionId, taskId);
  }

  /** Drop task ownership after a task stops; live ACP cleanup still happens. */
  unbindTaskSession(sessionId: string): void {
    this.taskBySession.delete(sessionId);
  }

  /**
   * Reply to the pending session/request_permission for this session's tool
   * call. Quietly no-ops if there's no pending request (e.g. the user clicks
   * the button twice or after the agent moved on).
   */
  respondToPermission(sessionId: string, toolCallId: string, allow: boolean): void {
    const key = permKey(sessionId, toolCallId);
    const pending = this.pendingPermissions.get(key);
    if (!pending) return;
    const durable = this.approvalStore?.resolveApproval(pending.approvalId, allow);
    // A restart or a competing client may have already resolved/expired it.
    // First durable answer wins; never send a conflicting answer to ACP.
    if (durable && (durable.state !== 'resolved' || durable.allow !== allow)) {
      this.pendingPermissions.delete(key);
      clearTimeout(pending.timer);
      return;
    }
    this.pendingPermissions.delete(key);
    clearTimeout(pending.timer);
    // Only ever answer for a session this app opened, on the child serving it.
    if (!this.owns(pending.handle, sessionId)) return;
    this.sup.send(pending.handle, {
      jsonrpc: '2.0', id: pending.requestId, result: permissionOutcome(pending.options, allow),
    });
  }

  /**
   * Stop a session and forget it. An isolated session's child is killed
   * (that is the only way to cancel a running turn on Hermes 0.20.6, which
   * has no session/cancel). A pooled child stays warm for its other sessions.
   */
  stopSession(sessionId: string): void {
    const handle = this.acpToHandle.get(sessionId);
    if (!handle) return;
    this.acpToHandle.delete(sessionId);
    this.taskBySession.delete(sessionId);
    this.modelsBySession.delete(sessionId);
    // Answer this session's open approvals so a pooled child is not left
    // waiting on them forever. Other sessions on the same child are untouched.
    for (const [key, p] of this.pendingPermissions) {
      if (p.sessionId !== sessionId) continue;
      this.pendingPermissions.delete(key);
      clearTimeout(p.timer);
      this.approvalStore?.resolveApproval(p.approvalId, false, 'session-stopped');
      try {
        this.sup.send(p.handle, { jsonrpc: '2.0', id: p.requestId, result: { outcome: { outcome: 'cancelled' } } });
      } catch {
        // child already gone
      }
    }
    if (this.isolatedHandles.has(handle)) {
      this.isolatedHandles.delete(handle);
      this.sup.shutdown(handle);
    }
  }

  /** Kill every connection — pooled and isolated (profile switch / app quit). */
  stopAll(): void {
    for (const pending of this.pendingPermissions.values()) {
      clearTimeout(pending.timer);
      this.approvalStore?.resolveApproval(pending.approvalId, false, 'bridge-stopped');
    }
    this.acpToHandle.clear();
    this.taskBySession.clear();
    this.modelsBySession.clear();
    this.pendingPermissions.clear();
    this.loading.clear();
    this.conns.clear();
    this.isolatedHandles.clear();
    this.sup.shutdownAll();
  }

  private emitJournal(msg: AcpServerMessage): void {
    const event = { ...msg } as AcpServerMessage;
    Object.defineProperty(event, 'eventId', { value: ++this.eventSeq, enumerable: false });
    const recent = [...(this.journal.get(msg.sessionId) ?? []), event].slice(-200);
    this.journal.set(msg.sessionId, recent);
    this.emit('event', event);
  }

  /** Emit to the renderer. Tokens are rate-limited; anything else flushes them first to keep order. */
  private out(msg: AcpServerMessage): void {
    if (msg.kind === 'token') return this.tokens.push(msg);
    this.tokens.flush(msg.sessionId);
    this.emitJournal(msg);
  }

  /** Expire a still-pending request by denying it once and informing the UI. */
  private expirePermission(key: string): void {
    const pending = this.pendingPermissions.get(key);
    if (!pending) return;
    const durable = this.approvalStore?.expireApproval(pending.approvalId);
    if (durable && durable.state !== 'expired') return;
    this.pendingPermissions.delete(key);
    if (!this.owns(pending.handle, pending.sessionId)) return;
    try {
      this.sup.send(pending.handle, {
        jsonrpc: '2.0', id: pending.requestId, result: permissionOutcome(pending.options, false),
      });
    } catch {
      return;
    }
    this.out({
      kind: 'approval-expired',
      sessionId: pending.sessionId,
      toolCallId: pending.toolCallId,
      description: pending.description,
    });
  }

  /** True when `sessionId` was opened (or is being loaded) by this app on `handle`. */
  private owns(handle: string, sessionId: string): boolean {
    return this.acpToHandle.get(sessionId) === handle || this.loading.get(sessionId) === handle;
  }

  private onSupervisorEvent = (event: AcpEvent): void => {
    // Hermes broadcasts session-scoped frames for every session sharing the
    // HERMES_HOME — gateway conversations (Delta Chat, Telegram, …) and other
    // ACP clients included — down every connected ACP client, pooled or
    // isolated. Only a session this app opened (or is loading) on this very
    // child may reach the renderer or have its permission request answered;
    // foreign and unlabelled frames are dropped, never stored or forwarded.
    if (event.kind === 'message') {
      const method = event.msg['method'];
      if (method === 'session/update' || method === 'session/request_permission') {
        const params = event.msg['params'] as Record<string, unknown> | undefined;
        const frameSid = typeof params?.['sessionId'] === 'string' ? (params['sessionId'] as string) : '';
        if (!frameSid || !this.owns(event.sessionId, frameSid)) return;
      }
    }

    // Stash session/request_permission so respondToPermission can find it.
    if (event.kind === 'message') {
      const msg = event.msg;
      if (msg['method'] === 'session/request_permission') {
        const id = msg['id'];
        const params = msg['params'] as Record<string, unknown> | undefined;
        const toolCall = params?.['toolCall'] as Record<string, unknown> | undefined;
        const toolCallId = typeof toolCall?.['toolCallId'] === 'string' ? toolCall['toolCallId'] : '';
        const options = Array.isArray(params?.['options'])
          ? (params!['options'] as PermissionOption[])
          : [];
        const sid = typeof params?.['sessionId'] === 'string' ? (params['sessionId'] as string) : '';
        if (toolCallId && (typeof id === 'string' || typeof id === 'number')) {
          const key = permKey(sid, toolCallId);
          const existing = this.pendingPermissions.get(key);
          if (existing) clearTimeout(existing.timer);
          const description = typeof toolCall?.['title'] === 'string' ? toolCall['title'] : 'Permission requested';
          const taskId = this.taskBySession.get(sid) ?? null;
          const approvalId = taskId ? `${taskId}:${sid}:${toolCallId}` : key;
          const durable = taskId && this.approvalStore
            ? this.approvalStore.requestApproval({ id: approvalId, taskId, sessionId: sid, toolCallId, description })
            : null;
          // A duplicated request after a reconnect observes the durable first
          // answer instead of reopening the permission decision.
          if (durable && durable.state !== 'pending') {
            this.sup.send(event.sessionId, {
              jsonrpc: '2.0', id, result: permissionOutcome(options, durable.state === 'resolved' && durable.allow === true),
            });
            return;
          }
          const timer = setTimeout(() => this.expirePermission(key), APPROVAL_TIMEOUT_MS);
          this.pendingPermissions.set(key, {
            approvalId,
            taskId,
            sessionId: sid,
            toolCallId,
            handle: event.sessionId,
            requestId: id,
            options,
            description,
            timer,
          });
        }
      }
    } else if (event.kind === 'exit' || event.kind === 'error') {
      // Re-key the failure onto the ACP sessionId(s) this handle served — the
      // renderer routes events by ACP sessionId, not our internal handle.
      const affected = [...this.acpToHandle].filter(([, h]) => h === event.sessionId).map(([id]) => id);
      const expected = event.kind === 'exit' && event.expected;
      const message = event.kind === 'error'
        ? event.error
        : (event.code === null ? 'Hermes ACP process was killed.' : `Hermes ACP process exited (code ${event.code}).`) +
          (event.detail ? ` ${event.detail}` : '');

      if (event.kind === 'exit') {
        for (const id of affected) { this.acpToHandle.delete(id); this.modelsBySession.delete(id); }
        for (const [key, conn] of this.conns) {
          if (conn.handle === event.sessionId) this.conns.delete(key);
        }
        this.isolatedHandles.delete(event.sessionId);
      }

      if (!expected && !(event.kind === 'exit' && event.code === 0)) {
        for (const sessionId of affected.length ? affected : [event.sessionId]) {
          this.out({ kind: 'session-error', sessionId, message, fatal: true });
        }
      }
      return;
    }

    for (const semantic of translateAcpEvent(event)) {
      this.out(semantic);
    }
  };
}

const permKey = (sessionId: string, toolCallId: string) => `${sessionId}\0${toolCallId}`;

/**
 * Map our binary `allow: boolean` to an ACP outcome. Allow only ever selects
 * "allow_once" — if the agent offers no such option we deny rather than grant
 * persistent permission on the user's behalf. Deny selects "reject_once" (the
 * tool call is refused, the turn continues); `cancelled` is the fallback when
 * the agent offers no reject option.
 */
export function permissionOutcome(options: PermissionOption[], allow: boolean): { outcome: Record<string, string> } {
  const byKind = (k: PermissionOptionKind) => options.find((o) => o?.kind === k);
  const choice = allow ? byKind('allow_once') : undefined;
  const pick = choice ?? byKind('reject_once');
  return pick
    ? { outcome: { outcome: 'selected', optionId: pick.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}
