import type { AttributionSnapshot } from '@hermes-cowork/core';
import type { Context, CoworkSettings, FundingAttribution, Project } from '../../shared/types';

export type PurserRequestHeaders = Record<
  'X-Purser-Project' | 'X-Purser-Parent' | 'X-Purser-Agent' | 'X-Purser-Job-Class' | 'X-Purser-Retry',
  string
>;

function fundingRef(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

type ResolveInput = {
  project: Pick<Project, 'id' | 'contextId' | 'fundingRef'> | null;
  context: Pick<Context, 'id' | 'fundingRef'> | null;
  settings: Pick<CoworkSettings, 'defaultFundingRef'>;
  tracked: boolean;
  capturedAt?: string;
};

/**
 * Capture the effective funding decision at an execution boundary. It never
 * validates a reference against Purser and never accepts a renderer-supplied
 * reference; that belongs to the later authenticated provider adapter.
 */
export function resolveAttribution(input: ResolveInput): AttributionSnapshot & FundingAttribution {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const base = {
    schemaVersion: 1 as const,
    capturedAt,
    projectId: input.project?.id ?? null,
    contextId: input.context?.id ?? input.project?.contextId ?? null,
  };
  if (!input.tracked) return { ...base, fundingRef: null, source: 'none', tracked: false };

  const candidates: Array<[AttributionSnapshot['source'], string | null]> = [
    ['project', fundingRef(input.project?.fundingRef)],
    ['context', fundingRef(input.context?.fundingRef)],
    ['settings', fundingRef(input.settings.defaultFundingRef)],
  ];
  const found = candidates.find(([, ref]) => ref !== null);
  return found
    ? { ...base, source: found[0], fundingRef: found[1], tracked: true }
    : { ...base, fundingRef: null, source: 'none', tracked: false };
}

/** Convert only a persisted, immutable attribution decision into the Hermes ACP extension. */
export function purserRequestHeaders(
  attribution: Pick<AttributionSnapshot, 'tracked' | 'fundingRef' | 'projectId'>,
  input: { parentId: string; profile: string; jobClass: 'coding' | 'chat'; retry: number },
): PurserRequestHeaders | null {
  const ref = fundingRef(attribution.fundingRef);
  if (!attribution.tracked || !ref || !attribution.projectId) return null;
  if (!input.parentId || !input.profile || !Number.isSafeInteger(input.retry) || input.retry < 0) {
    throw new Error('invalid immutable Purser execution attribution');
  }
  return {
    'X-Purser-Project': attribution.projectId,
    'X-Purser-Parent': input.parentId,
    'X-Purser-Agent': input.profile,
    'X-Purser-Job-Class': input.jobClass,
    'X-Purser-Retry': String(input.retry),
  };
}
