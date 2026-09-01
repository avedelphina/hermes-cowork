import { z } from 'zod';

// Wire shape from Hermes 0.20.6 GET /api/profiles -> { profiles: [ ... ] }.
// `active` is not on the row — api.profiles() fills it in from
// GET /api/profiles/active.
export const ProfileSummarySchema = z
  .object({
    name: z.string(),
    path: z.string(),
    model: z.string().nullish(),
    provider: z.string().nullish(),
  })
  .passthrough()
  .transform((p) => ({
    name: p.name,
    hermesHome: p.path,
    model: p.model ?? null,
    provider: p.provider ?? null,
    active: false,
  }));
export type ProfileSummary = z.infer<typeof ProfileSummarySchema>;

export const ProfileListSchema = z
  .object({ profiles: z.array(ProfileSummarySchema) })
  .transform((d) => d.profiles);

export const ActiveProfileSchema = z
  .object({ active: z.string().nullish() })
  .transform((d) => d.active ?? null);

// Wire shape from Hermes 0.20.6 GET /api/status: flat gateway_running plus a
// gateway_platforms map keyed by platform name.
export const StatusSchema = z
  .object({
    version: z.string(),
    gateway_running: z.boolean().nullish(),
    gateway_platforms: z
      .record(z.string(), z.object({ state: z.string().nullish() }).passthrough())
      .nullish(),
  })
  .passthrough()
  .transform((s) => ({
    hermesVersion: s.version,
    gateway: {
      running: s.gateway_running ?? false,
      platforms: Object.entries(s.gateway_platforms ?? {})
        .filter(([, v]) => v?.state === 'connected')
        .map(([k]) => k),
    },
  }));
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
