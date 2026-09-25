import { describe, it, expect } from 'vitest';
import { todoWrites, applyTodoWrite, toPlanEntries } from '@shared/todos';

const two = [{ id: 'a', content: 'alpha', status: 'pending' }, { id: 'b', content: 'beta', status: 'pending' }];

describe('todoWrites', () => {
  it('reads a direct todo_list call', () => {
    expect(todoWrites('todo_list', { todos: two })).toEqual([{ todos: two, merge: false }]);
    expect(todoWrites('todo_list: updating 1 task(s)', { merge: true, todos: [] })).toEqual([{ todos: [], merge: true }]);
  });

  it('reads todo writes out of the tool_call wrapper, in order, skipping other tools', () => {
    const args = { calls: [
      { name: 'read_file', arguments: { todos: [{ id: 'x' }] } },
      { name: 'todo_list', arguments: { todos: two } },
      { name: 'todo', arguments: { merge: true, todos: [] } },
    ] };
    expect(todoWrites('tool_call', args)).toEqual([{ todos: two, merge: false }, { todos: [], merge: true }]);
  });

  it('reads the single-call wrapper form', () => {
    expect(todoWrites('tool_call', { name: 'todo_list', arguments: { todos: two } })).toEqual([{ todos: two, merge: false }]);
    expect(todoWrites('tool_call', { name: 'terminal', arguments: { todos: two } })).toEqual([]);
  });

  it('ignores reads and unrelated tools', () => {
    expect(todoWrites('todo_list', {})).toEqual([]);
    expect(todoWrites('write_file', { todos: two })).toEqual([]);
    expect(todoWrites('todo_list', 'nope')).toEqual([]);
  });
});

describe('applyTodoWrite', () => {
  it('replaces the list and drops duplicate ids', () => {
    const out = applyTodoWrite([{ id: 'old', content: 'old', status: 'pending' }], [...two, two[0]], false);
    expect(out.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('merges by id, touching only the fields given, and appends new ids', () => {
    const out = applyTodoWrite(two, [{ id: 'a', status: 'completed' }, { id: 'c', content: 'gamma' }, { content: 'no id' }], true);
    expect(out).toEqual([
      { id: 'a', content: 'alpha', status: 'completed' },
      { id: 'b', content: 'beta', status: 'pending' },
      { id: 'c', content: 'gamma', status: 'pending' },
    ]);
  });

  it('falls back to pending for an unknown status', () => {
    expect(applyTodoWrite([], [{ id: 'a', content: 'x', status: 'bogus' }], false)[0]?.status).toBe('pending');
  });
});

describe('toPlanEntries', () => {
  it('keeps cancelled items as terminal, like the native plan', () => {
    expect(toPlanEntries([{ id: 'a', content: 'x', status: 'cancelled' }])).toEqual([{ content: '[cancelled] x', status: 'completed' }]);
  });
});
