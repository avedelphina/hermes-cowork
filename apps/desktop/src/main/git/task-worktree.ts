import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export type TaskGit = { branch: string; worktreePath: string; baseRef: string };

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString('utf8').trim();
    throw new Error(stderr || `git ${args.join(' ')} failed`);
  }
}

function slug(title: string): string {
  const value = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return value || 'task';
}

export function createTaskWorktree(cwd: string, taskId: string, title: string): TaskGit {
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  const status = git(root, ['status', '--porcelain']);
  if (status) throw new Error('The selected repository has uncommitted changes. Commit, stash, or explicitly opt out of an isolated worktree first.');

  const baseRef = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const branch = `cowork/${slug(title)}-${taskId.slice(0, 8)}`;
  const worktreePath = join(dirname(root), `${basename(root)}-${slug(title)}-${taskId.slice(0, 8)}`);
  if (existsSync(worktreePath)) throw new Error(`Cowork worktree path already exists: ${worktreePath}`);
  if (git(root, ['branch', '--list', branch])) throw new Error(`Cowork branch already exists: ${branch}`);
  git(root, ['worktree', 'add', '-b', branch, worktreePath, baseRef]);
  return { branch, worktreePath: realpathSync(resolve(worktreePath)), baseRef };
}
