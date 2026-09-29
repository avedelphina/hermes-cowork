// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveAttribution } from '@main/store/attribution';

const settings = { defaultFundingRef: 'default-wallet', trackChatsByDefault: false };
const project = { id: 'project-1', contextId: 'context-1', fundingRef: null };
const context = { id: 'context-1', fundingRef: 'context-wallet' };
const capturedAt = '2026-09-28T10:00:00.000Z';

describe('resolveAttribution', () => {
  it('uses project then context then Settings funding precedence', () => {
    expect(resolveAttribution({ project: { ...project, fundingRef: 'project-wallet' }, context, settings, tracked: true, capturedAt }))
      .toMatchObject({ fundingRef: 'project-wallet', source: 'project', tracked: true, projectId: 'project-1', contextId: 'context-1' });
    expect(resolveAttribution({ project, context, settings, tracked: true, capturedAt }))
      .toMatchObject({ fundingRef: 'context-wallet', source: 'context', tracked: true });
    expect(resolveAttribution({ project: { ...project, contextId: null }, context: null, settings, tracked: true, capturedAt }))
      .toMatchObject({ fundingRef: 'default-wallet', source: 'settings', tracked: true });
  });

  it('records an explicit untracked decision without exposing configured funding', () => {
    expect(resolveAttribution({ project, context, settings, tracked: false, capturedAt })).toEqual({
      schemaVersion: 1,
      fundingRef: null,
      source: 'none',
      tracked: false,
      capturedAt,
      projectId: 'project-1',
      contextId: 'context-1',
    });
  });

  it('normalises blank references and remains explicitly untracked when no source exists', () => {
    expect(resolveAttribution({
      project: { ...project, fundingRef: '  ' },
      context: { ...context, fundingRef: '' },
      settings: { ...settings, defaultFundingRef: ' ' },
      tracked: true,
      capturedAt,
    })).toMatchObject({ fundingRef: null, source: 'none', tracked: false });
  });

  it('keeps funding snapshots local to Cowork attribution', () => {
    expect(resolveAttribution({ project, context, settings, tracked: true, capturedAt }))
      .toMatchObject({ fundingRef: 'context-wallet', source: 'context', tracked: true });
  });
});
