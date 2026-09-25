// apps/desktop/src/main/orchestrator/acp-supervisor.ts
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { FrameDecoder, encodeFrame, type JsonRpcMessage } from './jsonrpc';
import { buildSpawnSpec } from './spawn-spec';
import type { RemoteOrigin } from '../../shared/types';

export type AcpSession = {
  id: string;
  profile: string;
  cwd: string;
};

export type AcpSpawnOptions = AcpSession & {
  binaryPath: string;
  hermesHome: string;
  /** Reach the agent over SSH instead of spawning locally. */
  remote?: RemoteOrigin | null;
};

export type AcpEvent =
  | { kind: 'message'; sessionId: string; msg: JsonRpcMessage }
  // `expected` is true when we asked the child to stop (shutdown/shutdownAll)
  | { kind: 'exit'; sessionId: string; code: number | null; expected: boolean; detail?: string }
  | { kind: 'error'; sessionId: string; error: string };

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

class AcpChild {
  readonly decoder = new FrameDecoder();
  readonly pending = new Map<string | number, PendingRequest>();
  /** Set by shutdown() so the exit handler can mark the exit as expected. */
  stopping = false;
  /** Recent stderr. For an ssh child this is where "Permission denied" lives. */
  stderrTail = '';
  constructor(public readonly proc: ChildProcess, public readonly session: AcpSession) {}
}

/** The last few stderr lines, for an error message a person can act on. */
export function stderrSummary(tail: string, lines = 3, max = 300): string {
  const s = tail.split('\n').map((l) => l.trim()).filter(Boolean).slice(-lines).join(' / ');
  return s.length > max ? '…' + s.slice(-max) : s;
}

export class AcpSupervisor extends EventEmitter {
  private children = new Map<string, AcpChild>();

  spawn(opts: AcpSpawnOptions): void {
    const spec = buildSpawnSpec(opts);
    const proc = spawn(spec.command, spec.args, {
      // Remote spawns have no local cwd — the task folder is a remote path,
      // delivered to the agent via session/new.
      ...(spec.cwd ? { cwd: spec.cwd } : {}),
      env: spec.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const child = new AcpChild(proc, { id: opts.id, profile: opts.profile, cwd: opts.cwd });
    this.children.set(opts.id, child);

    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const msg of child.decoder.push(chunk)) {
        this.routeIncoming(child, opts.id, msg);
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      // Hermes ACP logs to stderr; surface for debugging.
      const text = chunk.toString('utf8');
      console.error(`[acp ${opts.id}]`, text.trimEnd());
      child.stderrTail = (child.stderrTail + text).slice(-2000);
    });

    proc.on('error', (err) => {
      this.rejectAllPending(child, err);
      this.emit('event', { kind: 'error', sessionId: opts.id, error: err.message } satisfies AcpEvent);
    });

    proc.on('exit', (code) => {
      // Only ssh children: a local Hermes logs routine warnings to stderr that
      // would be noise here, but ssh's stderr is the failure reason itself
      // (Permission denied, Host key verification failed, command not found).
      const detail = opts.remote && !child.stopping ? stderrSummary(child.stderrTail) : '';
      this.rejectAllPending(
        child,
        new Error(`ACP child exited (code=${code ?? 'null'})${detail ? `: ${detail}` : ''}`),
      );
      this.emit('event', {
        kind: 'exit',
        sessionId: opts.id,
        code,
        expected: child.stopping,
        ...(detail ? { detail } : {}),
      } satisfies AcpEvent);
      this.children.delete(opts.id);
    });
  }

  /**
   * Send a tracked JSON-RPC request and resolve when the matching response
   * arrives. Rejects if the child exits or errors before a response arrives.
   */
  request(sessionId: string, method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    const child = this.children.get(sessionId);
    if (!child || !child.proc.stdin) {
      return Promise.reject(new Error(`no ACP child for session ${sessionId}`));
    }
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
            child.pending.delete(id);
            reject(new Error(`ACP ${method} timed out after ${timeoutMs / 1000}s`));
          }, timeoutMs)
        : undefined;
      child.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      child.proc.stdin!.write(encodeFrame({ jsonrpc: '2.0', id, method, params: params as JsonRpcMessage }));
    });
  }

  /** Send a raw JSON-RPC message (notification or response). Fire-and-forget. */
  send(sessionId: string, msg: JsonRpcMessage): void {
    const child = this.children.get(sessionId);
    if (!child || !child.proc.stdin) {
      throw new Error(`no ACP child for session ${sessionId}`);
    }
    child.proc.stdin.write(encodeFrame(msg));
  }

  shutdown(sessionId: string): void {
    const child = this.children.get(sessionId);
    if (!child) return;
    child.stopping = true;
    try {
      child.proc.stdin?.end();
    } catch {
      // ignore
    }
    const proc = child.proc;
    setTimeout(() => proc.kill('SIGTERM'), 1000);
    setTimeout(() => proc.kill('SIGKILL'), 5000);
  }

  shutdownAll(): void {
    for (const id of this.children.keys()) this.shutdown(id);
  }

  list(): AcpSession[] {
    return Array.from(this.children.values()).map((c) => c.session);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal: split incoming JSON-RPC traffic into request/response handling.
  //  - Responses (id present, no method) resolve any pending request().
  //  - Everything else is forwarded as 'message' for the bridge to translate.
  // ─────────────────────────────────────────────────────────────────────────
  private routeIncoming(child: AcpChild, handle: string, msg: JsonRpcMessage): void {
    const hasMethod = typeof msg['method'] === 'string';
    const id = msg['id'];
    const isResponse = !hasMethod && (typeof id === 'string' || typeof id === 'number');

    if (isResponse) {
      const pending = child.pending.get(id as string | number);
      if (pending) {
        child.pending.delete(id as string | number);
        if ('error' in msg && msg['error']) {
          const err = msg['error'] as { code?: number; message?: string };
          pending.reject(new Error(`ACP error ${err.code ?? '?'}: ${err.message ?? 'unknown'}`));
        } else {
          pending.resolve(msg['result']);
        }
        return; // responses to our own requests aren't broadcast
      }
    }

    this.emit('event', { kind: 'message', sessionId: handle, msg } satisfies AcpEvent);
  }

  private rejectAllPending(child: AcpChild, err: Error): void {
    for (const p of child.pending.values()) p.reject(err);
    child.pending.clear();
  }
}
