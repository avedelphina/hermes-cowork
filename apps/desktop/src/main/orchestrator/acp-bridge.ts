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
import type { AcpServerMessage, AcpModels, AcpModelInfo, RemoteOrigin } from '../../shared/types';
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
  /** Give this session its own ACP child (not the shared pool) so stopSession
   * can hard-kill the running turn — Hermes 0.20.6 has no session/cancel. */
  isolate?: boolean;
};

type PermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

type PermissionOption = {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
};

type PendingPermission = {
  sessionId: string;
  toolCallId: string;
  handle: string;
  requestId: string | number;
  options: PermissionOption[];
  description: string;
  timer: ReturnType<typeof setTimeout>;
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

export class AcpBridge extends EventEmitter {
  private acpToHandle = new Map<string, string>();
  /** Model state as reported by session/new (and session/load when present). */
  private modelsBySession = new Map<string, AcpModels>();
  private pendingPermissions = new Map<string, PendingPermission>();
  /** One warm ACP connection per `${profile}\0${hermesHome}\0${sshTarget}`. */
  private conns = new Map<string, Conn>();
  /** Handles spawned for a single isolated session — safe to hard-kill. */
  private isolatedHandles = new Set<string>();
  /** Sessions mid-`session/load` → handle. Their replay frames arrive before
   * the load response binds them, so ownership must already hold. */
  private loading = new Map<string, string>();
  private tokens = new TokenCoalescer((m) => this.emit('event', m));

  constructor(private readonly sup: AcpSupervisor) {
    super();
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
    const key = `${opts.profile}\0${opts.hermesHome}\0${opts.remote?.sshTarget ?? ''}`;
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
  async sendPrompt(sessionId: string, text: string): Promise<void> {
    const handle = this.acpToHandle.get(sessionId);
    if (!handle) throw new Error(`unknown ACP session ${sessionId}`);

    try {
      await this.sup.request(handle, 'session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text }],
      });
    } finally {
      this.out({ kind: 'done', sessionId });
    }
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
    this.modelsBySession.delete(sessionId);
    // Answer this session's open approvals so a pooled child is not left
    // waiting on them forever. Other sessions on the same child are untouched.
    for (const [key, p] of this.pendingPermissions) {
      if (p.sessionId !== sessionId) continue;
      this.pendingPermissions.delete(key);
      clearTimeout(p.timer);
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
    this.acpToHandle.clear();
    this.modelsBySession.clear();
    for (const pending of this.pendingPermissions.values()) clearTimeout(pending.timer);
    this.pendingPermissions.clear();
    this.loading.clear();
    this.conns.clear();
    this.isolatedHandles.clear();
    this.sup.shutdownAll();
  }

  /** Emit to the renderer. Tokens are rate-limited; anything else flushes them first to keep order. */
  private out(msg: AcpServerMessage): void {
    if (msg.kind === 'token') return this.tokens.push(msg);
    this.tokens.flush(msg.sessionId);
    this.emit('event', msg);
  }

  /** Expire a still-pending request by denying it once and informing the UI. */
  private expirePermission(key: string): void {
    const pending = this.pendingPermissions.get(key);
    if (!pending) return;
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
          const timer = setTimeout(() => this.expirePermission(key), APPROVAL_TIMEOUT_MS);
          this.pendingPermissions.set(key, {
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
