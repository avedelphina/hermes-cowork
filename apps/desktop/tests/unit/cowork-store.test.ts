// apps/desktop/tests/unit/cowork-store.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCoworkStore, relInCwd } from '@renderer/features/cowork/cowork.store';

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

  describe('edit tracking', () => {
    const checkpoint = vi.fn();
    const edit = (over: Record<string, unknown> = {}) => ({
      kind: 'tool-call' as const, sessionId: 's', toolCallId: 't1',
      name: 'write', op: 'edit', paths: ['/w/draft.md'], args: undefined, ...over,
    });
    beforeEach(() => {
      checkpoint.mockReset().mockResolvedValue('old');
      (window as unknown as { hermes: unknown }).hermes = { fs: { checkpoint } };
    });

    it('checkpoints an edit-kind tool call inside the task folder, once per file', async () => {
      useCoworkStore.getState().ingestAcp(edit());
      useCoworkStore.getState().ingestAcp(edit({ toolCallId: 't2' }));
      await vi.waitFor(() => expect(useCoworkStore.getState().checkpoints).toHaveLength(1));
      expect(checkpoint).toHaveBeenCalledWith('t', 'draft.md');
      expect(useCoworkStore.getState().checkpoints[0]).toMatchObject({ rel: 'draft.md', before: 'old' });
    });

    it('resolves relative paths against the task folder', async () => {
      useCoworkStore.getState().ingestAcp(edit({ paths: [], args: { path: './src/a.ts' } }));
      await vi.waitFor(() => expect(checkpoint).toHaveBeenCalledWith('t', 'src/a.ts'));
    });

    it('ignores paths outside the task folder and non-edit tools', () => {
      useCoworkStore.getState().ingestAcp(edit({ paths: ['/tmp/x'] }));
      useCoworkStore.getState().ingestAcp(edit({ paths: ['../x'] }));
      useCoworkStore.getState().ingestAcp(edit({ op: 'read' }));
      expect(checkpoint).not.toHaveBeenCalled();
    });

    it('bumps changeRev when an edit finishes and when the turn ends', () => {
      const { ingestAcp } = useCoworkStore.getState();
      ingestAcp(edit());
      ingestAcp({ kind: 'tool-result', sessionId: 's', toolCallId: 'other', result: null });
      expect(useCoworkStore.getState().changeRev).toBe(0);
      ingestAcp({ kind: 'tool-result', sessionId: 's', toolCallId: 't1', result: null });
      expect(useCoworkStore.getState().changeRev).toBe(1);
      ingestAcp({ kind: 'done', sessionId: 's' });
      expect(useCoworkStore.getState().changeRev).toBe(2);
    });
  });

  it('keeps reasoning apart from the reply', () => {
    const { ingestAcp } = useCoworkStore.getState();
    ingestAcp({ kind: 'token', sessionId: 's', text: 'hmm ', thought: true });
    ingestAcp({ kind: 'token', sessionId: 's', text: 'ok', thought: true });
    ingestAcp({ kind: 'token', sessionId: 's', text: 'Done.' });
    expect(useCoworkStore.getState().transcript).toEqual([
      { role: 'thought', text: 'hmm ok' },
      { role: 'agent', text: 'Done.' },
    ]);
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

describe('agentState', () => {
  it('blocked beats working beats idle', async () => {
    const { agentState } = await import('@renderer/features/cowork/cowork.store');
    expect(agentState('running', 1)).toBe('blocked');
    expect(agentState('running', 0)).toBe('working');
    expect(agentState('idle', 0)).toBe('idle');
  });
});

describe('relInCwd', () => {
  it('maps absolute and relative paths, rejects escapes', () => {
    expect(relInCwd('/w/', '/w/a/b.ts')).toBe('a/b.ts');
    expect(relInCwd('/w', 'a/b.ts')).toBe('a/b.ts');
    expect(relInCwd('/w', '/other/a')).toBeNull();
    expect(relInCwd('/w', '/wx/a')).toBeNull();
    expect(relInCwd('/w', 'a/../../b')).toBeNull();
    expect(relInCwd('', '/a')).toBeNull();
  });
});
