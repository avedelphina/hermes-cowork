// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWithinRoot, isExistingDir } from '@main/security/paths';

describe('resolveWithinRoot', () => {
  const root = '/Users/x/project';

  it('accepts a plain child path', () => {
    expect(resolveWithinRoot(root, 'src/index.ts')).toBe('/Users/x/project/src/index.ts');
  });

  it('accepts the root itself', () => {
    expect(resolveWithinRoot(root, '.')).toBe('/Users/x/project');
  });

  it('rejects a ../ escape', () => {
    expect(resolveWithinRoot(root, '../other/secret')).toBeNull();
  });

  it('rejects an absolute path outside the root', () => {
    expect(resolveWithinRoot(root, '/etc/passwd')).toBeNull();
  });

  it('accepts an absolute path that is inside the root', () => {
    expect(resolveWithinRoot(root, '/Users/x/project/a/b')).toBe('/Users/x/project/a/b');
  });

  it('rejects a path that resolves to the root parent', () => {
    expect(resolveWithinRoot(root, 'src/../..')).toBeNull();
  });

  it('rejects a sibling dir sharing a name prefix', () => {
    expect(resolveWithinRoot('/Users/x/project', '/Users/x/project-evil/x')).toBeNull();
  });
});

describe('isExistingDir', () => {
  it('true for a real directory', () => {
    const d = mkdtempSync(join(tmpdir(), 'sec-'));
    expect(isExistingDir(d)).toBe(true);
  });

  it('false for a file', () => {
    const d = mkdtempSync(join(tmpdir(), 'sec-'));
    const f = join(d, 'a.txt');
    writeFileSync(f, 'x');
    expect(isExistingDir(f)).toBe(false);
  });

  it('false for a missing path and for a relative path', () => {
    expect(isExistingDir('/nope/does/not/exist')).toBe(false);
    expect(isExistingDir('relative/dir')).toBe(false);
  });
});
