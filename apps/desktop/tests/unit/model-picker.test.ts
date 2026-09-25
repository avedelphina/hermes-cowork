import { describe, it, expect } from 'vitest';
import { groupByProvider, providerLabel } from '@renderer/shell/ModelPicker';

const m = (modelId: string) => ({ modelId, name: modelId });

describe('groupByProvider', () => {
  it('groups provider:model ids, keeping order, and leaves colon-less ids ungrouped', () => {
    const g = groupByProvider([m('kimi-coding:k3'), m('openrouter:a/b'), m('kimi-coding:k2'), m('plain')]);
    expect(g.map((x) => [x.provider, x.models.map((y) => y.modelId)])).toEqual([
      ['kimi-coding', ['kimi-coding:k3', 'kimi-coding:k2']],
      ['openrouter', ['openrouter:a/b']],
      ['', ['plain']],
    ]);
  });
});

describe('providerLabel', () => {
  it('says gh-copilot for copilot, passes others through, names the ungrouped bucket', () => {
    expect(providerLabel('copilot')).toBe('gh-copilot');
    expect(providerLabel('openrouter')).toBe('openrouter');
    expect(providerLabel('')).toBe('other');
  });
});
