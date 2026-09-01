// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { translateAcpEvent } from '@main/orchestrator/acp-translator';
import type { AcpEvent } from '@main/orchestrator/acp-supervisor';

describe('translateAcpEvent — lifecycle', () => {
  it('surfaces an unexpected non-zero exit as a fatal session-error', () => {
    const out = translateAcpEvent({ kind: 'exit', sessionId: 'h1', code: 1, expected: false } as AcpEvent);
    expect(out).toEqual([
      { kind: 'session-error', sessionId: 'h1', message: expect.stringContaining('code 1'), fatal: true },
    ]);
  });

  it('stays silent for a clean exit (code 0)', () => {
    expect(translateAcpEvent({ kind: 'exit', sessionId: 'h1', code: 0, expected: false } as AcpEvent)).toEqual([]);
  });

  it('stays silent for an exit we asked for, even with a non-zero code', () => {
    expect(translateAcpEvent({ kind: 'exit', sessionId: 'h1', code: 143, expected: true } as AcpEvent)).toEqual([]);
  });

  it('reports a signal kill (code null) as a crash', () => {
    const out = translateAcpEvent({ kind: 'exit', sessionId: 'h1', code: null, expected: false } as AcpEvent);
    expect(out).toEqual([{ kind: 'session-error', sessionId: 'h1', message: expect.stringContaining('killed'), fatal: true }]);
  });

  it('surfaces a spawn error as a fatal session-error', () => {
    const out = translateAcpEvent({ kind: 'error', sessionId: 'h1', error: 'ENOENT' } as AcpEvent);
    expect(out).toEqual([{ kind: 'session-error', sessionId: 'h1', message: 'ENOENT', fatal: true }]);
  });
});

describe('translateAcpEvent — session/update (Hermes 0.20.6 wire shapes)', () => {
  const msg = (update: unknown): AcpEvent => ({
    kind: 'message',
    sessionId: 'h1',
    msg: { jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1', update } },
  });

  it('maps agent_message_chunk text to a token', () => {
    const out = translateAcpEvent(msg({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'P' } }));
    expect(out).toEqual([{ kind: 'token', sessionId: 's1', text: 'P' }]);
  });

  it('maps a replayed user_message_chunk to a user-role token', () => {
    const out = translateAcpEvent(msg({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'hi' } }));
    expect(out).toEqual([{ kind: 'token', sessionId: 's1', text: 'hi', role: 'user' }]);
  });

  it('drops usage_update / available_commands_update / session_info_update', () => {
    for (const v of ['usage_update', 'available_commands_update', 'session_info_update']) {
      expect(translateAcpEvent(msg({ sessionUpdate: v }))).toEqual([]);
    }
  });

  it('maps a tool_call, pulling touched files from ACP locations', () => {
    const out = translateAcpEvent(msg({
      sessionUpdate: 'tool_call', toolCallId: 'tc1', title: 'write: /w/a.txt', kind: 'edit',
      locations: [{ path: '/w/a.txt' }],
    }));
    expect(out).toEqual([
      { kind: 'tool-call', sessionId: 's1', toolCallId: 'tc1', name: 'write: /w/a.txt', op: 'edit', paths: ['/w/a.txt'], args: undefined },
    ]);
  });

  it('maps a completed tool_call_update to a tool-result', () => {
    const out = translateAcpEvent(msg({ sessionUpdate: 'tool_call_update', status: 'completed', toolCallId: 't1', rawOutput: { ok: true } }));
    expect(out).toEqual([{ kind: 'tool-result', sessionId: 's1', toolCallId: 't1', result: { ok: true } }]);
  });

  it('ignores JSON-RPC responses to our own requests', () => {
    expect(translateAcpEvent({ kind: 'message', sessionId: 'h1', msg: { jsonrpc: '2.0', id: 'x', result: {} } } as AcpEvent)).toEqual([]);
  });
});
