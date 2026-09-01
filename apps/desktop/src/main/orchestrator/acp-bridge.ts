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
import type { AcpServerMessage } from '../../shared/types';
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

export class AcpBridge extends EventEmitter {
  private acpToHandle = new Map<string, string>();
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
      })) as { sessionId?: string };
      if (typeof res?.sessionId !== 'string') throw new Error('session/new returned no sessionId');
      this.acpToHandle.set(res.sessionId, handle);
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
      clientInfo: { name: 'hermes-cowork-desktop', version: '0.1.0' },
    });
    return handle;
  }

  /**
   * Resume an existing Hermes session by id. Per ACP, session/load takes the
   * id we already hold and its response carries no sessionId — the agent just
   * replays the conversation as session/update notifications during the call.
   */
  async loadSession(opts: StartSessionOpts & { sessionId: string }): Promise<{ sessionId: string }> {
    const handle = await this.connFor(opts);
    await this.sup.request(handle, 'session/load', {
      sessionId: opts.sessionId,
      cwd: opts.cwd,
      mcpServers: [],
    });
    this.acpToHandle.set(opts.sessionId, handle);
    return { sessionId: opts.sessionId };
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
          clientInfo: { name: 'hermes-cowork-desktop', version: '0.1.0' },
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
    this.pendingPermissions.clear();
    this.conns.clear();
    this.isolatedHandles.clear();
    this.sup.shutdownAll();
  }

  private onSupervisorEvent = (event: AcpEvent): void => {
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
    } else if (event.kind === 'exit') {
      // Child is gone — drop its sessions and its pooled connection so the
      // next call respawns instead of writing to a dead pipe.
      for (const [acpId, handle] of this.acpToHandle) {
        if (handle === event.sessionId) this.acpToHandle.delete(acpId);
      }
      for (const [key, conn] of this.conns) {
        if (conn.handle === event.sessionId) this.conns.delete(key);
      }
      this.isolatedHandles.delete(event.sessionId);
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
