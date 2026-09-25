// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenCoalescer, TOKEN_WINDOW_MS } from '@main/orchestrator/token-coalescer';
import type { AcpServerMessage } from '@shared/types';

describe('TokenCoalescer', () => {
  let out: AcpServerMessage[];
  let c: TokenCoalescer;
  const tok = (text: string, sessionId = 's', role?: 'user' | 'agent') =>
    role ? { kind: 'token' as const, sessionId, text, role } : { kind: 'token' as const, sessionId, text };

  beforeEach(() => {
    vi.useFakeTimers();
    out = [];
    c = new TokenCoalescer((m) => out.push(m));
  });
  afterEach(() => vi.useRealTimers());

  it('sends the first token immediately, merges the rest of the burst on the trailing edge', () => {
    c.push(tok('a')); c.push(tok('b')); c.push(tok('c'));
    expect(out).toEqual([tok('a')]);
    vi.advanceTimersByTime(TOKEN_WINDOW_MS);
    expect(out).toEqual([tok('a'), tok('bc')]);
  });

  it('goes leading again after an idle window', () => {
    c.push(tok('a'));
    vi.advanceTimersByTime(TOKEN_WINDOW_MS);
    c.push(tok('b'));
    expect(out).toEqual([tok('a'), tok('b')]);
  });

  it('flush() sends buffered text now, so later events keep their order', () => {
    c.push(tok('a')); c.push(tok('b'));
    c.flush('s');
    expect(out).toEqual([tok('a'), tok('b')]);
    vi.advanceTimersByTime(TOKEN_WINDOW_MS * 2);
    expect(out).toHaveLength(2);
  });

  it('never merges across roles or sessions', () => {
    c.push(tok('u1', 's', 'user')); c.push(tok('u2', 's', 'user')); c.push(tok('a1'));
    c.push(tok('x', 'other'));
    vi.advanceTimersByTime(TOKEN_WINDOW_MS);
    expect(out).toEqual([tok('u1', 's', 'user'), tok('u2', 's', 'user'), tok('x', 'other'), tok('a1')]);
  });
});
