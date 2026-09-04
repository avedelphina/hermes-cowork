// apps/desktop/tests/unit/cowork-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCoworkStore } from '@renderer/features/cowork/cowork.store';

/** Bind the store to a session id — ingestAcp() drops events until then. */
const bind = (sessionId = 's') =>
  useCoworkStore.getState().startTask({
    taskId: 't', sessionId, goal: 'g', cwd: '/w', profile: 'p', kickoff: 'k',
  });

beforeEach(() => {
  useCoworkStore.getState().reset();
  bind();
});

describe('cowork store', () => {
  it('drops events for other sessions and before any task is bound', () => {
    useCoworkStore.getState().reset();
    useCoworkStore.getState().ingestAcp({ kind: 'token', sessionId: 's', text: 'leak' });
    bind('s');
    useCoworkStore.getState().ingestAcp({ kind: 'token', sessionId: 'other', text: 'leak' });
    expect(useCoworkStore.getState().transcript).toEqual([]);
  });

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

  it('tracks the plan step list from plan events', () => {
    useCoworkStore.getState().ingestAcp({
      kind: 'plan', sessionId: 's',
      entries: [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }],
    });
    expect(useCoworkStore.getState().planEntries).toEqual([
      { content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' },
    ]);
  });

  it('does not re-gate when a plan event only ticks statuses', () => {
    const s = useCoworkStore.getState();
    s.ingestAcp({ kind: 'plan', sessionId: 's', entries: [{ content: 'A', status: 'pending' }] });
    s.approvePlan();
    s.ingestAcp({ kind: 'plan', sessionId: 's', entries: [{ content: 'A', status: 'completed' }] });
    expect(useCoworkStore.getState().approved).toBe(true);
  });

  it('re-arms the approval gate when a new plan is proposed after approval', () => {
    const s = useCoworkStore.getState();
    s.ingestAcp({ kind: 'plan', sessionId: 's', entries: [{ content: 'Old step', status: 'pending' }] });
    s.approvePlan();
    expect(useCoworkStore.getState().approved).toBe(true);

    s.ingestAcp({ kind: 'plan', sessionId: 's', entries: [{ content: 'Brand new step', status: 'pending' }] });
    const st = useCoworkStore.getState();
    expect(st.approved).toBe(false);
    expect(st.planEntries).toEqual([{ content: 'Brand new step', status: 'pending' }]);
    expect(st.transcript.at(-1)).toEqual({ role: 'system', text: '📋 New plan proposed — review and approve.' });
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
