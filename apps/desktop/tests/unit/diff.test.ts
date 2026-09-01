import { describe, it, expect } from 'vitest';
import { lineDiff } from '@shared/diff';

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
