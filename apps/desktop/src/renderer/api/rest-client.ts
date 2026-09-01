import { z } from 'zod';
import {
  ProfileListSchema,
  ActiveProfileSchema,
  StatusSchema,
  SessionListSchema,
  KanbanTaskSchema,
} from './schemas';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function get<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, any>): Promise<T> {
  const raw = await window.hermes.rest.get<unknown>(path);
  return schema.parse(raw);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function post<T>(path: string, body: unknown, schema: z.ZodType<T, z.ZodTypeDef, any>): Promise<T> {
  const raw = await window.hermes.rest.post<unknown>(path, body);
  return schema.parse(raw);
}

export const api = {
  status: () => get('/api/status', StatusSchema),
  profiles: async () => {
    const [list, active] = await Promise.all([
      get('/api/profiles', ProfileListSchema),
      get('/api/profiles/active', ActiveProfileSchema).catch(() => null),
    ]);
    return list.map((p) => ({ ...p, active: p.name === active }));
  },
  sessions: (limit = 50) =>
    get(`/api/sessions?limit=${limit}`, SessionListSchema),
  kanbanBoard: () =>
    get('/api/plugins/kanban/board', z.array(KanbanTaskSchema)),
  createKanbanTask: (input: { title: string; body?: string; assignee?: string; parentIds?: number[] }) =>
    post('/api/plugins/kanban/tasks', input, KanbanTaskSchema),
};
