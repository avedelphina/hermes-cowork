import { describe, it, expect } from 'vitest';
import { ProfileSummarySchema, KanbanTaskSchema } from '@renderer/api/schemas';

describe('ProfileSummarySchema', () => {
  it('maps the Hermes 0.20.6 profile row shape', () => {
    const out = ProfileSummarySchema.parse({
      name: 'research',
      path: '/Users/x/.hermes/profiles/research',
      model: 'model-router',
      provider: 'azure-foundry',
      is_default: false,
    });
    expect(out).toEqual({
      name: 'research',
      hermesHome: '/Users/x/.hermes/profiles/research',
      model: 'model-router',
      provider: 'azure-foundry',
      active: false,
    });
  });
  it('defaults model/provider to null when absent', () => {
    const out = ProfileSummarySchema.parse({ name: 'x', path: '/p' });
    expect(out.model).toBeNull();
    expect(out.provider).toBeNull();
  });
  it('rejects missing required fields', () => {
    expect(() => ProfileSummarySchema.parse({ name: 'x' })).toThrow();
  });
});

describe('KanbanTaskSchema', () => {
  it('rejects unknown status', () => {
    expect(() =>
      KanbanTaskSchema.parse({
        id: 1,
        title: 't',
        body: null,
        status: 'wat',
        assignee: null,
        createdAt: '2026-05-08T00:00:00Z',
      }),
    ).toThrow();
  });
});
