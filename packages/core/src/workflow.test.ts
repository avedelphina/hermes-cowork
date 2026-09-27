import { describe, expect, it } from 'vitest';
import { TaskWorkflow, type TaskWorkflowSnapshot } from './index';

function setup(initial: Partial<TaskWorkflowSnapshot> = {}) {
  let state: TaskWorkflowSnapshot = { version: 1, tasks: [], events: [], approvals: [], runs: [], ...initial };
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

  it('owns the design, re-plan, verification, and completion gates', () => {
    const { workflow } = setup();
    const task = workflow.create(input);
    workflow.start(task.id, 'session-1');
    expect(workflow.approveDesign(task.id)).toMatchObject({ approved: true, designApproved: true, status: 'executing' });
    expect(workflow.rearmForPlan(task.id)).toMatchObject({ approved: false, designApproved: false, implementationApproved: false, verificationApproved: false, status: 'awaiting_approval' });
    expect(workflow.approveVerification(task.id)).toBeNull();
    workflow.approveDesign(task.id);
    expect(workflow.approveVerification(task.id)).toMatchObject({ implementationApproved: true, verificationApproved: true, status: 'executing' });
    expect(workflow.complete(task.id)).toMatchObject({ status: 'done' });
    expect(workflow.rearmForPlan(task.id)).toBeNull();
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

  it('creates one active run at a time and increments attempts after it finishes', () => {
    const { workflow, state } = setup();
    const task = workflow.create(input);
    const first = workflow.createRun(task.id, 'session-1');
    expect(first).toMatchObject({ id: 'task-1:1', attempt: 1, status: 'created', offset: 0, acpSessionId: 'session-1' });
    expect(workflow.createRun(task.id, 'session-2')).toBeNull();
    expect(workflow.attachRun(first!.id)).toMatchObject({ status: 'attached' });
    expect(workflow.finishRun(first!.id, 'finished')).toMatchObject({ status: 'finished' });
    expect(workflow.get(task.id)?.activeRunId).toBeNull();
    expect(workflow.createRun(task.id, 'session-2')).toMatchObject({ id: 'task-1:2', attempt: 2 });
    expect(state().runs).toHaveLength(2);
  });

  it('only advances a live run offset monotonically at complete byte boundaries', () => {
    const { workflow } = setup();
    const task = workflow.create(input);
    const run = workflow.createRun(task.id, 'session-1')!;
    workflow.attachRun(run.id);
    expect(workflow.advanceRunOffset(run.id, 128)).toMatchObject({ offset: 128 });
    expect(workflow.advanceRunOffset(run.id, 64)).toMatchObject({ offset: 128 });
    expect(workflow.advanceRunOffset(run.id, -1)).toBeNull();
    expect(workflow.finishRun(run.id, 'lost')).toMatchObject({ status: 'lost', offset: 128 });
    expect(workflow.advanceRunOffset(run.id, 256)).toMatchObject({ offset: 128 });
  });

  it('normalises legacy snapshots without a run list', () => {
    const { workflow } = setup({ runs: undefined as never });
    expect(workflow.listRuns()).toEqual([]);
  });

  it('preserves attached runs during restart reconciliation', () => {
    const first = setup();
    const task = first.workflow.create(input);
    const run = first.workflow.createRun(task.id, null)!;
    first.workflow.bindRunSession(run.id, 'session-1');
    first.workflow.attachRun(run.id);
    first.workflow.start(task.id, 'session-1');
    first.workflow.interruptLiveTasks();
    expect(first.workflow.get(task.id)?.status).toBe('planning');
    expect(first.workflow.getRun(run.id)?.status).toBe('attached');
  });
  it('preserves the current desktop restart policy until pipe ownership exists', () => {
    const { workflow } = setup();
    const task = workflow.create(input);
    workflow.start(task.id, 'session-1');
    workflow.interruptLiveTasks();
    expect(workflow.get(task.id)?.status).toBe('interrupted');
  });
});
