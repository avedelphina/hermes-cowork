// apps/desktop/tests/unit/cowork-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCoworkStore } from '@renderer/features/cowork/cowork.store';

beforeEach(() => useCoworkStore.getState().reset());

describe('cowork store', () => {
  it('appends agent tokens', () => {
    const { ingestAcp } = useCoworkStore.getState();
    ingestAcp({ kind: 'token', sessionId: 's', text: 'Plan: ' });
    ingestAcp({ kind: 'token', sessionId: 's', text: '7 steps.' });
    expect(useCoworkStore.getState().transcript[0]?.text).toBe('Plan: 7 steps.');
  });

  it('records artifacts from edit-kind tool calls (path from ACP locations), de-duplicated', () => {
    const call = {
      kind: 'tool-call' as const, sessionId: 's', toolCallId: 't1',
      name: 'write: /tmp/draft.md', op: 'edit', paths: ['/tmp/draft.md'], args: undefined,
    };
    useCoworkStore.getState().ingestAcp(call);
    useCoworkStore.getState().ingestAcp({ ...call, toolCallId: 't2' });
    const arts = useCoworkStore.getState().artifacts;
    expect(arts).toHaveLength(1);
    expect(arts[0]?.path).toBe('/tmp/draft.md');
  });

  it('ignores read-kind tool calls', () => {
    useCoworkStore.getState().ingestAcp({
      kind: 'tool-call', sessionId: 's', toolCallId: 't1',
      name: 'skill view (anikke)', op: 'read', paths: [], args: {},
    });
    expect(useCoworkStore.getState().artifacts).toHaveLength(0);
  });

  it('queues approvals', () => {
    useCoworkStore.getState().ingestAcp({
      kind: 'approval-request', sessionId: 's', toolCallId: 't1', description: 'drop production table?',
    });
    expect(useCoworkStore.getState().approvals).toEqual([
      { toolCallId: 't1', description: 'drop production table?' },
    ]);
  });

  it('echoes steering messages and tracks turn status', () => {
    const s = useCoworkStore.getState();
    s.startTask({ sessionId: 'acp1', goal: 'g', cwd: '/w', profile: 'p' });
    expect(useCoworkStore.getState().status).toBe('running');

    s.ingestAcp({ kind: 'done', sessionId: 'acp1' });
    expect(useCoworkStore.getState().status).toBe('idle');

    s.pushUserText('also check the logs');
    const st = useCoworkStore.getState();
    expect(st.status).toBe('running');
    expect(st.transcript.at(-1)).toEqual({ role: 'user', text: 'also check the logs' });
  });

  it('records a stop as a system line and goes idle', () => {
    const s = useCoworkStore.getState();
    s.startTask({ sessionId: 'acp1', goal: 'g', cwd: '/w', profile: 'p' });
    s.markStopped();
    const st = useCoworkStore.getState();
    expect(st.status).toBe('idle');
    expect(st.transcript.at(-1)?.role).toBe('system');
  });

  it('surfaces a session-error as a system line and goes idle', () => {
    const s = useCoworkStore.getState();
    s.startTask({ sessionId: 'acp1', goal: 'g', cwd: '/w', profile: 'p' });
    s.ingestAcp({ kind: 'session-error', sessionId: 'acp1', message: 'ACP process exited', fatal: true });
    const st = useCoworkStore.getState();
    expect(st.status).toBe('idle');
    expect(st.transcript.at(-1)).toEqual({ role: 'system', text: '⚠️ ACP process exited' });
  });
});
