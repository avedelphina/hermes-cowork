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
import type { AcpServerMessage, AcpModels, AcpModelInfo } from '../../shared/types';
import { translateAcpEvent } from './acp-translator';

const ACP_PROTOCOL_VERSION = 1;

type StartSessionOpts = {
  profile: string;
  cwd: string;
  binaryPath: string;
  hermesHome: string;
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
  handle: string;
  requestId: string | number;
  options: PermissionOption[];
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
  /** One warm ACP connection per `${profile}\0${hermesHome}`. */
  private conns = new Map<string, Conn>();
  /** Handles spawned for a single isolated session — safe to hard-kill. */
  private isolatedHandles = new Set<string>();

  constructor(private readonly sup: AcpSupervisor) {
    super();
    this.sup.on('event', this.onSupervisorEvent);
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
      })) as { sessionId?: string; models?: unknown };
      if (typeof res?.sessionId !== 'string') throw new Error('session/new returned no sessionId');
      this.acpToHandle.set(res.sessionId, handle);
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
    await this.sup.request(handle, 'session/set_mode', { sessionId, modeId });
  }

  /** Cached model state for a session, or null if we never saw session/new for it. */
  getModels(sessionId: string): AcpModels | null {
    return this.modelsBySession.get(sessionId) ?? null;
  }

  /** Switch the model for a live session (ACP `session/set_model`). */
  async setModel(sessionId: string, modelId: string): Promise<void> {
    const handle = this.acpToHandle.get(sessionId);
    if (!handle) throw new Error(`unknown ACP session ${sessionId}`);
    await this.sup.request(handle, 'session/set_model', { sessionId, modelId });
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
    });
    await this.sup.request(handle, 'initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'hermes-cowork-desktop', version: '0.1.1' },
    });
    return handle;
  }

  /**
   * Resume an existing Hermes session by id. Per ACP, session/load takes the
   * id we already hold and its response carries no sessionId — the agent just
   * replays the conversation as session/update notifications during the call.
   */
  async loadSession(opts: StartSessionOpts & { sessionId: string }): Promise<{ sessionId: string }> {
    const handle = opts.isolate ? await this.spawnDedicated(opts) : await this.connFor(opts);
    try {
      const res = (await this.sup.request(handle, 'session/load', {
        sessionId: opts.sessionId,
        cwd: opts.cwd,
        mcpServers: [],
      })) as { models?: unknown } | null;
      this.acpToHandle.set(opts.sessionId, handle);
      const models = normalizeModels(res?.models);
      if (models) this.modelsBySession.set(opts.sessionId, models);
      return { sessionId: opts.sessionId };
    } catch (err) {
      if (opts.isolate) {
        this.isolatedHandles.delete(handle);
        this.sup.shutdown(handle);
      }
      throw err;
    }
  }

  /** Get (or lazily create + initialize) the pooled connection for a profile. */
  private async connFor(opts: StartSessionOpts): Promise<string> {
    const key = `${opts.profile}\0${opts.hermesHome}`;
    let conn = this.conns.get(key);
    if (!conn) {
      const handle = randomUUID();
      this.sup.spawn({
        id: handle,
        profile: opts.profile,
        cwd: opts.cwd,
        binaryPath: opts.binaryPath,
        hermesHome: opts.hermesHome,
      });
      const ready = this.sup
        .request(handle, 'initialize', {
          protocolVersion: ACP_PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: { name: 'hermes-cowork-desktop', version: '0.1.1' },
        })
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
      this.emit('event', { kind: 'done', sessionId } satisfies AcpServerMessage);
    }
  }

  /**
   * Reply to the most-recent pending session/request_permission for this
   * tool call. Quietly no-ops if there's no pending request (e.g. the user
   * clicks the button twice or after the agent moved on).
   */
  respondToPermission(toolCallId: string, allow: boolean): void {
    const pending = this.pendingPermissions.get(toolCallId);
    if (!pending) return;
    this.pendingPermissions.delete(toolCallId);

    const result = allow
      ? { outcome: { outcome: 'selected', optionId: pickAllowOptionId(pending.options) } }
      : { outcome: { outcome: 'cancelled' } };

    this.sup.send(pending.handle, { jsonrpc: '2.0', id: pending.requestId, result });
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
    for (const [tcId, p] of this.pendingPermissions) {
      if (p.handle === handle) this.pendingPermissions.delete(tcId);
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
    this.pendingPermissions.clear();
    this.conns.clear();
    this.isolatedHandles.clear();
    this.sup.shutdownAll();
  }

  /** The single ACP session an isolated child owns, or undefined if unmapped. */
  private ownedSessionFor(handle: string): string | undefined {
    for (const [sessionId, h] of this.acpToHandle) {
      if (h === handle) return sessionId;
    }
    return undefined;
  }

  private onSupervisorEvent = (event: AcpEvent): void => {
    // An isolated child serves exactly one ACP session. Hermes broadcasts
    // session/update for every session sharing the HERMES_HOME — gateway
    // conversations (Delta Chat, Telegram, …) included — down every connected
    // ACP client, so a live turn from an unrelated session streams in here
    // too. Only surface a session-scoped frame whose sessionId is an exact
    // match for the one session this child owns; drop foreign and unlabelled.
    if (event.kind === 'message' && this.isolatedHandles.has(event.sessionId)) {
      const method = event.msg['method'];
      if (method === 'session/update' || method === 'session/request_permission') {
        const owned = this.ownedSessionFor(event.sessionId);
        const params = event.msg['params'] as Record<string, unknown> | undefined;
        const frameSid = typeof params?.['sessionId'] === 'string' ? (params['sessionId'] as string) : undefined;
        if (owned && frameSid !== owned) return;
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
        if (toolCallId && (typeof id === 'string' || typeof id === 'number')) {
          this.pendingPermissions.set(toolCallId, {
            handle: event.sessionId,
            requestId: id,
            options,
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
        : event.code === null ? 'Hermes ACP process was killed.' : `Hermes ACP process exited (code ${event.code}).`;

      if (event.kind === 'exit') {
        for (const id of affected) { this.acpToHandle.delete(id); this.modelsBySession.delete(id); }
        for (const [key, conn] of this.conns) {
          if (conn.handle === event.sessionId) this.conns.delete(key);
        }
        this.isolatedHandles.delete(event.sessionId);
      }

      if (!expected && !(event.kind === 'exit' && event.code === 0)) {
        for (const sessionId of affected.length ? affected : [event.sessionId]) {
          this.emit('event', { kind: 'session-error', sessionId, message, fatal: true } satisfies AcpServerMessage);
        }
      }
      return;
    }

    for (const semantic of translateAcpEvent(event)) {
      this.emit('event', semantic);
    }
  };
}

/**
 * Map our binary `allow: boolean` to a real ACP optionId. The agent decides
 * the menu of options; we prefer "allow_once" so we never accidentally grant
 * persistent permission on the user's behalf.
 */
function pickAllowOptionId(options: PermissionOption[]): string {
  const byKind = (k: PermissionOptionKind) => options.find((o) => o?.kind === k);
  const choice = byKind('allow_once') ?? byKind('allow_always') ?? options[0];
  return choice?.optionId ?? '';
}
