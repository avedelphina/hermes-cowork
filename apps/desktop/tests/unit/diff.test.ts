import { describe, it, expect } from 'vitest';
import { lineDiff, hunks } from '@shared/diff';

describe('lineDiff', () => {
  it('reports no change for identical text', () => {
    const d = lineDiff('a\nb\nc', 'a\nb\nc');
    expect(d).toMatchObject({ added: 0, removed: 0 });
    expect(d.rows.every((r) => r.type === ' ')).toBe(true);
  });

  it('detects an inserted line', () => {
    const d = lineDiff('a\nc', 'a\nb\nc');
    expect(d).toMatchObject({ added: 1, removed: 0 });
    expect(d.rows.find((r) => r.type === '+')?.text).toBe('b');
  });

  it('detects a removed line', () => {
    const d = lineDiff('a\nb\nc', 'a\nc');
    expect(d).toMatchObject({ added: 0, removed: 1 });
    expect(d.rows.find((r) => r.type === '-')?.text).toBe('b');
  });

  it('detects a modified line as remove + add', () => {
    const d = lineDiff('hello\nworld', 'hello\nthere');
    expect(d).toMatchObject({ added: 1, removed: 1 });
  });

  it('bails on a huge file', () => {
    const big = new Array(5000).fill('x').join('\n');
    expect(lineDiff(big, big + '\ny').rows[0]?.text).toMatch(/too large/);
  });
});

describe('hunks', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`);

  it('collapses unchanged runs away from a change', () => {
    const before = lines(20).join('\n');
    const after = lines(20).map((l) => (l === 'l10' ? 'changed' : l)).join('\n');
    const h = hunks(lineDiff(before, after).rows, 2);
    expect(h.filter((r) => r.skipped).map((r) => r.text)).toEqual(['⋯ 8 unchanged lines', '⋯ 7 unchanged lines']);
    expect(h.filter((r) => r.type !== ' ').map((r) => r.text)).toEqual(['l10', 'changed']);
    expect(h).toHaveLength(8); // skip, 2 ctx, -, +, 2 ctx, skip
  });

  it('returns everything when the change is near both ends', () => {
    const h = hunks(lineDiff('a\nb\nc', 'a\nx\nc').rows, 3);
    expect(h.some((r) => r.skipped)).toBe(false);
  });

  it('collapses identical text into one skip row', () => {
    const h = hunks(lineDiff(lines(10).join('\n'), lines(10).join('\n')).rows);
    expect(h).toEqual([{ type: ' ', text: '⋯ 10 unchanged lines', skipped: true }]);
  });
});
