// apps/desktop/src/shared/todos.ts
//
// Hermes' ACP adapter only turns a todo call into a `plan` update when the
// tool is named "todo" — but the tool is now `todo_list`, so no plan frame is
// ever sent (verified against a live session; upstream still has the stale
// check). The call itself does arrive as a tool_call whose rawInput carries
// the arguments, so the plan can be rebuilt client-side by mirroring the
// tool's replace / merge-by-id semantics.

export type TodoItem = { id: string; content: string; status: string };
export type PlanEntry = { content: string; status: string };

const TODO_TOOL = /^todo(_list)?$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * The writes a tool call makes to the todo list (none if it is not one).
 * `args` is the ACP rawInput: `{ todos, merge? }` for a direct call, or one of
 * the tool_call wrapper forms — `{ name, arguments }` or
 * `{ calls: [{ name, arguments }] }` — which is what a session/load history
 * replay shows. `name` is the tool-call title.
 */
export function todoWrites(name: string, args: unknown): Array<{ todos: unknown[]; merge: boolean }> {
  if (!isObj(args)) return [];
  const direct = (a: unknown) =>
    isObj(a) && Array.isArray(a['todos']) ? [{ todos: a['todos'] as unknown[], merge: a['merge'] === true }] : [];
  const wrapped = (c: unknown) =>
    isObj(c) && typeof c['name'] === 'string' && TODO_TOOL.test(c['name']) ? direct(c['arguments']) : [];
  return [
    ...(/^todo/.test(name) ? direct(args) : []),
    ...wrapped(args),
    ...(Array.isArray(args['calls']) ? args['calls'].flatMap(wrapped) : []),
  ];
}

/** Apply one write like Hermes' TodoStore: replace, or merge by id (fields given only). */
export function applyTodoWrite(items: TodoItem[], todos: unknown[], merge: boolean): TodoItem[] {
  const valid = (s: unknown) => typeof s === 'string' && ['pending', 'in_progress', 'completed', 'cancelled'].includes(s);
  const norm = (t: unknown): TodoItem => {
    const o = isObj(t) ? t : {};
    const id = String(o['id'] ?? '').trim() || '?';
    return {
      id,
      content: String(o['content'] ?? '').trim() || '(invalid item)',
      status: valid(o['status']) ? (o['status'] as string) : 'pending',
    };
  };
  if (!merge) {
    const seen = new Set<string>();
    return todos.map(norm).filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  }
  const next = items.map((i) => ({ ...i }));
  for (const t of todos) {
    if (!isObj(t) || !String(t['id'] ?? '').trim()) continue; // can't merge without an id
    const id = String(t['id']).trim();
    const cur = next.find((i) => i.id === id);
    if (!cur) next.push(norm(t));
    else {
      if (t['content']) cur.content = String(t['content']).trim();
      if (valid(t['status'])) cur.status = t['status'] as string;
    }
  }
  return next;
}

/** Same mapping Hermes uses for a native plan: ACP has no "cancelled", so it stays terminal. */
export function toPlanEntries(items: TodoItem[]): PlanEntry[] {
  return items.map((i) =>
    i.status === 'cancelled'
      ? { content: `[cancelled] ${i.content}`, status: 'completed' }
      : { content: i.content, status: i.status },
  );
}
