import { z } from 'zod';

export const ProfileSummarySchema = z.object({
  name: z.string(),
  active: z.boolean(),
  hermesHome: z.string(),
  model: z.string().nullable().default(null),
  provider: z.string().nullable().default(null),
});
export type ProfileSummary = z.infer<typeof ProfileSummarySchema>;

export const StatusSchema = z.object({
  hermesVersion: z.string(),
  dashboardPort: z.number(),
  gateway: z.object({
    running: z.boolean(),
    platforms: z.array(z.string()),
  }),
});
export type Status = z.infer<typeof StatusSchema>;

// Wire shape from Hermes 0.20.6 GET /api/sessions -> { sessions: [ ... ] }.
// snake_case, unix-float timestamps, most fields nullable.
export const SessionSummarySchema = z
  .object({
    id: z.string(),
    title: z.string().nullish(),
    source: z.string().nullish(),
    model: z.string().nullish(),
    input_tokens: z.number().nullish(),
    output_tokens: z.number().nullish(),
    started_at: z.number().nullish(),
    ended_at: z.number().nullish(),
  })
  .transform((s) => ({
    id: s.id,
    title: s.title ?? null,
    source: s.source ?? null,
    model: s.model ?? null,
    inputTokens: s.input_tokens ?? 0,
    outputTokens: s.output_tokens ?? 0,
    updatedAt: s.ended_at ?? s.started_at ?? 0,
  }));
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionListSchema = z
  .object({ sessions: z.array(SessionSummarySchema) })
  .transform((d) => d.sessions);

export const KanbanTaskSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  body: z.string().nullable(),
  status: z.enum(['triage', 'todo', 'ready', 'running', 'blocked', 'done', 'archived']),
  assignee: z.string().nullable(),
  parents: z.array(z.number().int()).default([]),
  createdAt: z.string(),
});
export type KanbanTask = z.infer<typeof KanbanTaskSchema>;

export const KanbanEventSchema = z.object({
  id: z.number().int(),
  taskId: z.number().int(),
  kind: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
  ts: z.string(),
});
export type KanbanEvent = z.infer<typeof KanbanEventSchema>;
