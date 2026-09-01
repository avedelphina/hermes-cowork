// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contextFiles, listDir, readFilePreview } from '@main/fs/project-fs';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pfs-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'README.md'), '# hi\n');
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, 'AGENTS.md'), 'instructions\n');
  writeFileSync(join(root, '.secret'), 'nope\n');
});

describe('contextFiles', () => {
  it('reports AGENTS.md when present, .hermes.md when not', () => {
    expect(contextFiles(root)).toEqual(['AGENTS.md']);
  });
});

describe('listDir', () => {
  it('lists a directory, dirs first, hiding dotfiles except context files', () => {
    const { entries } = listDir(root);
    expect(entries.map((e) => e.name)).toEqual(['src', 'AGENTS.md', 'README.md']);
    expect(entries[0].kind).toBe('dir');
  });

  it('lists a subdirectory by relative path', () => {
    expect(listDir(root, 'src').entries.map((e) => e.name)).toEqual(['a.ts']);
  });

  it('rejects a ../ escape', () => {
    expect(() => listDir(root, '../..')).toThrow(/escapes/);
  });

  it('rejects a symlink that points outside the root', () => {
    const outside = mkdtempSync(join(tmpdir(), 'out-'));
    symlinkSync(outside, join(root, 'link'));
    expect(() => listDir(root, 'link')).toThrow(/escapes/);
  });
});

describe('readFilePreview', () => {
  it('returns text for a source file', () => {
    const p = readFilePreview(root, 'src/a.ts');
    expect(p).toMatchObject({ kind: 'text', name: 'a.ts', truncated: false });
    if (p.kind === 'text') expect(p.text).toContain('export const a');
  });

  it('rejects a traversal path', () => {
    expect(() => readFilePreview(root, '../../etc/passwd')).toThrow(/escapes/);
  });

  it('flags an unknown binary type as unsupported', () => {
    writeFileSync(join(root, 'blob.bin'), Buffer.from([0, 1, 2, 3]));
    expect(readFilePreview(root, 'blob.bin').kind).toBe('unsupported');
  });
});
