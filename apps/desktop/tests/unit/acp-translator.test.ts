// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { translateAcpEvent } from '@main/orchestrator/acp-translator';
import type { AcpEvent } from '@main/orchestrator/acp-supervisor';

describe('translateAcpEvent — lifecycle', () => {
  it('surfaces an ACP child exit as a fatal session-error', () => {
    const out = translateAcpEvent({ kind: 'exit', sessionId: 'h1', code: 1 } as AcpEvent);
    expect(out).toEqual([
      { kind: 'session-error', sessionId: 'h1', message: expect.stringContaining('code 1'), fatal: true },
    ]);
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

  it('drops usage_update / available_commands_update / session_info_update', () => {
    for (const v of ['usage_update', 'available_commands_update', 'session_info_update']) {
      expect(translateAcpEvent(msg({ sessionUpdate: v }))).toEqual([]);
    }
  });

  it('maps a completed tool_call_update to a tool-result', () => {
    const out = translateAcpEvent(msg({ sessionUpdate: 'tool_call_update', status: 'completed', toolCallId: 't1', rawOutput: { ok: true } }));
    expect(out).toEqual([{ kind: 'tool-result', sessionId: 's1', toolCallId: 't1', result: { ok: true } }]);
  });

  it('ignores JSON-RPC responses to our own requests', () => {
    expect(translateAcpEvent({ kind: 'message', sessionId: 'h1', msg: { jsonrpc: '2.0', id: 'x', result: {} } } as AcpEvent)).toEqual([]);
  });
});
