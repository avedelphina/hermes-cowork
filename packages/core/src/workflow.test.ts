import { describe, expect, it } from 'vitest';
import { TaskWorkflow, type TaskWorkflowSnapshot } from './index';

function setup(initial: Partial<TaskWorkflowSnapshot> = {}) {
  let state: TaskWorkflowSnapshot = { version: 1, tasks: [], events: [], approvals: [], ...initial };
  let tick = 0;
  const workflow = new TaskWorkflow(
    { read: () => state, write: (next) => { state = next; } },
    { now: () => `2026-09-27T00:00:0${tick++}.000Z` },
    { uuid: () => 'task-1' },
  );
  return { workflow, state: () => state };
}

const input = { title: 'Named task', cwd: '/work', profile: 'anikke', projectId: null };

describe('TaskWorkflow', () => {
  it('creates named drafts and starts them exactly once', () => {
    const { workflow } = setup();
    const task = workflow.create(input);
    expect(task).toMatchObject({ id: 'task-1', status: 'draft', acpSessionId: null, approved: false });
    expect(workflow.start(task.id, 'session-1')).toMatchObject({ status: 'planning', acpSessionId: 'session-1' });
    expect(workflow.start(task.id, 'session-2')).toBeNull();
  });

  it('normalises legacy task records without losing existing fields', () => {
    const { workflow } = setup({
      tasks: [{ id: 'legacy', goal: 'Old name', cwd: '/work', profile: 'p', projectId: null, status: 'done', approved: false, createdAt: 'a', updatedAt: 'a' } as never],
    });
    expect(workflow.get('legacy')).toMatchObject({
      title: 'Old name', acpSessionId: null, parentTaskId: null,
      designApproved: false, implementationApproved: false, verificationApproved: false,
      git: null,
      eventSequence: 0, activeRunId: null,
    });
  });

  it('rejects an impossible terminal transition', () => {
    const { workflow } = setup();
    const task = workflow.create(input);
    workflow.start(task.id, 'session-1');
    expect(workflow.patch(task.id, { status: 'done' })).not.toBeNull();
    expect(workflow.patch(task.id, { status: 'executing' })).toBeNull();
  });

  it('persists ordered events and replays strictly after a sequence', () => {
    const { workflow, state } = setup();
    const task = workflow.create(input);
    workflow.start(task.id, 'session-1');
    workflow.patch(task.id, { status: 'awaiting_approval' });
    expect(workflow.eventsAfter(task.id, 1).map((event) => event.sequence)).toEqual([2, 3]);
    expect(state().events.map((event) => event.kind)).toEqual(['task-created', 'task-started', 'task-updated']);
  });

  it('persists approvals and applies first-answer-wins semantics', () => {
    const { workflow, state } = setup();
    const approval = workflow.requestApproval({ id: 'task-1:sess-1:call-1', taskId: 'task-1', sessionId: 'sess-1', toolCallId: 'call-1', description: 'run tests' });
    expect(approval.state).toBe('pending');
    expect(workflow.requestApproval({ id: approval.id, taskId: approval.taskId, sessionId: approval.sessionId, toolCallId: approval.toolCallId, description: approval.description })).toEqual(approval);
    expect(workflow.resolveApproval(approval.id, true, 'device-a')).toMatchObject({ state: 'resolved', allow: true, resolvedBy: 'device-a' });
    expect(workflow.resolveApproval(approval.id, false, 'device-b')).toMatchObject({ state: 'resolved', allow: true, resolvedBy: 'device-a' });
    expect(workflow.pendingApprovals()).toEqual([]);
    expect(state().approvals).toHaveLength(1);
  });

  it('expires pending approvals as denied and does not re-arm them', () => {
    const { workflow } = setup();
    const approval = workflow.requestApproval({ id: 'a', taskId: 'task-1', sessionId: 's', toolCallId: 'c', description: 'write file' });
    expect(workflow.expireApproval(approval.id)).toMatchObject({ state: 'expired', allow: false });
    expect(workflow.resolveApproval(approval.id, true)?.state).toBe('expired');
  });

  it('preserves the current desktop restart policy until pipe ownership exists', () => {
    const { workflow } = setup();
    const task = workflow.create(input);
    workflow.start(task.id, 'session-1');
    workflow.interruptLiveTasks();
    expect(workflow.get(task.id)?.status).toBe('interrupted');
  });
});
