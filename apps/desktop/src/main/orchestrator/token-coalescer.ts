// apps/desktop/src/main/orchestrator/token-coalescer.ts
//
// Caps token IPC at ~1 message per WINDOW_MS per session. Leading + trailing:
// the first token after an idle window goes out immediately (no added latency
// on the first character), the rest of a burst is merged and sent when the
// window closes. Any non-token event for the session must call flush() first
// so ordering (tokens → tool-call → done) is preserved.

import type { AcpServerMessage } from '../../shared/types';

export const TOKEN_WINDOW_MS = 60;

type Token = Extract<AcpServerMessage, { kind: 'token' }>;
type Window = { role: Token['role']; thought: boolean; text: string; timer: ReturnType<typeof setTimeout> };

export class TokenCoalescer {
  private windows = new Map<string, Window>();

  constructor(private send: (msg: AcpServerMessage) => void) {}

  push(t: Token): void {
    const w = this.windows.get(t.sessionId);
    if (!w) {
      this.send(t);
      this.open(t.sessionId, t.role, !!t.thought);
      return;
    }
    // Merge only same-role, same-kind text (history replay interleaves
    // user/agent turns; thoughts and replies must stay separate messages).
    if (w.text && (w.role !== t.role || w.thought !== !!t.thought)) this.drain(t.sessionId, w);
    w.role = t.role;
    w.thought = !!t.thought;
    w.text += t.text;
  }

  /** Send any buffered text now and close the window. */
  flush(sessionId: string): void {
    const w = this.windows.get(sessionId);
    if (!w) return;
    clearTimeout(w.timer);
    this.windows.delete(sessionId);
    this.drain(sessionId, w);
  }

  private open(sessionId: string, role: Token['role'], thought: boolean): void {
    const timer = setTimeout(() => {
      const w = this.windows.get(sessionId);
      if (!w) return;
      if (!w.text) return void this.windows.delete(sessionId);
      this.drain(sessionId, w);
      this.open(sessionId, w.role, w.thought); // just sent: stay rate-limited for another window
    }, TOKEN_WINDOW_MS);
    timer.unref?.();
    this.windows.set(sessionId, { role, thought, text: '', timer });
  }

  private drain(sessionId: string, w: Window): void {
    if (!w.text) return;
    const msg: Token = { kind: 'token', sessionId, text: w.text };
    if (w.role) msg.role = w.role;
    if (w.thought) msg.thought = true;
    w.text = '';
    this.send(msg);
  }
}
