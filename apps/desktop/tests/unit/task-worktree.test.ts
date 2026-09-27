// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTaskWorktree } from '@main/git/task-worktree';

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'cowork-git-'));
  const run = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  run(['init', '-b', 'main']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'Cowork test']);
  writeFileSync(join(root, 'README.md'), 'test\n');
  run(['add', '.']);
  run(['commit', '-m', 'initial']);
  return root;
}

describe('createTaskWorktree', () => {
  it('creates a task branch and sibling worktree from a clean repository', () => {
    const root = repo();
    const result = createTaskWorktree(root, 'task-12345678', 'Fix the widget');
    expect(result).toMatchObject({ branch: 'cowork/fix-the-widget-task-123', baseRef: 'main' });
    expect(result.worktreePath).not.toBe(root);
    expect(execFileSync('git', ['-C', result.worktreePath, 'branch', '--show-current'], { encoding: 'utf8' }).trim()).toBe(result.branch);
  });

  it('refuses a dirty repository before creating a worktree', () => {
    const root = repo();
    writeFileSync(join(root, 'dirty.txt'), 'not committed\n');
    expect(() => createTaskWorktree(root, 'task-dirty', 'Dirty')).toThrow(/uncommitted changes/);
  });
});
