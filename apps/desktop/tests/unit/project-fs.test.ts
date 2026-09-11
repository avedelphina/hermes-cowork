// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, lstatSync, statSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { contextFiles, listDir, readFilePreview, snapshotFile, revertFile } from '@main/fs/project-fs';

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

describe('snapshotFile / revertFile', () => {
  it('snapshots current content, null for a missing file', () => {
    expect(snapshotFile(root, 'src/a.ts')).toContain('export const a');
    expect(snapshotFile(root, 'src/nope.ts')).toBeNull();
  });

  it('revert restores the given content inside the root', () => {
    revertFile(root, 'src/a.ts', 'reverted\n');
    expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toBe('reverted\n');
  });

  it('revert with null deletes a file that did not exist before the edit', () => {
    writeFileSync(join(root, 'brand-new.ts'), 'x');
    revertFile(root, 'brand-new.ts', null);
    expect(snapshotFile(root, 'brand-new.ts')).toBeNull();
  });

  it('snapshot and revert reject a traversal path', () => {
    expect(() => snapshotFile(root, '../x')).toThrow(/escapes/);
    expect(() => revertFile(root, '../../etc/x', 'no')).toThrow(/escapes/);
  });

  it('revert refuses a new file under a symlinked parent that points outside', () => {
    const outside = mkdtempSync(join(tmpdir(), 'pfs-out-'));
    symlinkSync(outside, join(root, 'link'));
    expect(() => revertFile(root, 'link/planted.txt', 'x')).toThrow(/escapes/);
    expect(existsSync(join(outside, 'planted.txt'))).toBe(false);
  });

  it('snapshot refuses a binary file rather than checkpoint it lossily', () => {
    writeFileSync(join(root, 'img.dat'), Buffer.from([0xff, 0xfe, 0x00, 0x80]));
    expect(() => snapshotFile(root, 'img.dat')).toThrow(/binary/);
  });
});

describe('readFilePreview truncation', () => {
  it('reads only the head of a large text file', () => {
    writeFileSync(join(root, 'big.txt'), 'a'.repeat(3 * 1024 * 1024));
    const p = readFilePreview(root, 'big.txt');
    expect(p.kind === 'text' && p.truncated && p.text.length === 2 * 1024 * 1024).toBe(true);
  });
});

// A swapped-in symlink at use time is the TOCTOU the pinned-directory,
// no-follow operations close: whatever sits at the path when revert runs,
// nothing outside the root is written, deleted or read.
describe('symlink swap at use time', () => {
  let outside: string;
  beforeEach(() => {
    outside = mkdtempSync(join(tmpdir(), 'pfs-victim-'));
    writeFileSync(join(outside, 'victim.txt'), 'precious\n');
  });

  it('revert write replaces a symlinked target instead of writing through it', () => {
    symlinkSync(join(outside, 'victim.txt'), join(root, 'a.txt'));
    revertFile(root, 'a.txt', 'restored\n');
    expect(readFileSync(join(outside, 'victim.txt'), 'utf8')).toBe('precious\n');
    expect(lstatSync(join(root, 'a.txt')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('restored\n');
  });

  it('revert delete removes only the link, never its target', () => {
    symlinkSync(join(outside, 'victim.txt'), join(root, 'new.txt'));
    revertFile(root, 'new.txt', null);
    expect(existsSync(join(root, 'new.txt'))).toBe(false);
    expect(readFileSync(join(outside, 'victim.txt'), 'utf8')).toBe('precious\n');
  });

  it('reads refuse a link that leaves the root but follow one that stays inside', () => {
    symlinkSync(join(outside, 'victim.txt'), join(root, 'out.txt'));
    expect(() => snapshotFile(root, 'out.txt')).toThrow(/escapes/);
    expect(() => readFilePreview(root, 'out.txt')).toThrow(/escapes/);
    symlinkSync(join(root, 'src', 'a.ts'), join(root, 'in.ts'));
    expect(snapshotFile(root, 'in.ts')).toContain('export const a');
  });

  it('a FIFO planted at the path fails fast instead of hanging main', () => {
    execFileSync('mkfifo', [join(root, 'pipe.txt')]);
    expect(() => readFilePreview(root, 'pipe.txt')).toThrow(/not a file/);
  });

  it('revert keeps the file mode (an executable stays executable)', () => {
    writeFileSync(join(root, 'run.sh'), 'old\n');
    chmodSync(join(root, 'run.sh'), 0o755);
    revertFile(root, 'run.sh', 'new\n');
    expect(statSync(join(root, 'run.sh')).mode & 0o777).toBe(0o755);
  });
});
