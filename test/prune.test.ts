import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vite-plus/test';

import {
  author,
  clonedApi,
  commit,
  git,
  gitwork,
  remote,
  tempDir,
} from './helpers.js';

/** A Workspace as `gitwork init` makes it, listing no Projects. */
function emptyWorkspace(): string {
  const dir = tempDir();
  gitwork(['init'], { cwd: dir });
  return dir;
}

/** Clones a new remote into `projects/<name>` of the Workspace: an Unlisted Project. */
function unlistedProject(dir: string, name: string): string {
  const folder = join(dir, 'projects', name);
  mkdirSync(join(dir, 'projects'), { recursive: true });
  git(dir, 'clone', '-q', remote(), folder);
  return folder;
}

/** Gives the Project at `folder` a pushed .gitignore, so ignored files can be made. */
function ignore(folder: string, pattern: string): void {
  writeFileSync(join(folder, '.gitignore'), `${pattern}\n`);
  git(folder, 'add', '.gitignore');
  git(folder, ...author, 'commit', '-q', '-m', 'ignore');
  git(folder, 'push', '-q', 'origin', 'HEAD');
}

const readOnly: string[] = [];
afterEach(() => {
  for (const folder of readOnly.splice(0)) chmodSync(folder, 0o755);
});

describe('gitwork prune', () => {
  test('deletes an Unlisted Project that holds nothing that could be lost, ignored files included', () => {
    const { dir } = clonedApi();
    const old = unlistedProject(dir, 'old');
    ignore(old, '.env');
    writeFileSync(join(old, '.env'), 'SECRET=1\n');

    const result = gitwork(['prune'], { cwd: dir });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('old  deleted');
    expect(result.stdout).toContain('1 deleted');
    expect(existsSync(old)).toBe(false);
    expect(existsSync(join(dir, 'projects', 'api', '.git'))).toBe(true);
    expect(result.stderr).not.toContain('unlisted');
  });

  test('skips a Project with anything that could be lost, giving every reason', () => {
    const dir = emptyWorkspace();
    const old = unlistedProject(dir, 'old');
    git(old, 'switch', '-q', '-c', 'spike/payments');
    commit(old, 'a.txt');
    commit(old, 'b.txt');
    writeFileSync(join(old, 'stashed.txt'), 'x\n');
    git(old, 'add', 'stashed.txt');
    git(old, ...author, 'stash', '-q');
    writeFileSync(join(old, 'untracked.txt'), 'x\n');

    const result = gitwork(['prune'], { cwd: dir });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'old  skipped: dirty, 2 unpushed commits on spike/payments, 1 stash',
    );
    expect(result.stdout).toContain('1 skipped');
    expect(existsSync(join(old, '.git'))).toBe(true);
    expect(result.stderr).toContain('unlisted: old');
  });

  test('skips a Project with commits only on a detached HEAD', () => {
    const dir = emptyWorkspace();
    const old = unlistedProject(dir, 'old');
    git(old, 'switch', '-q', '--detach');
    commit(old);

    const result = gitwork(['prune'], { cwd: dir });

    expect(result.stdout).toContain(
      'old  skipped: 1 unpushed commit on detached HEAD',
    );
    expect(existsSync(old)).toBe(true);
  });

  test('skips a Project with a merge or rebase in progress', () => {
    const dir = emptyWorkspace();
    const merging = unlistedProject(dir, 'merging');
    git(merging, 'switch', '-q', '-c', 'feature');
    commit(merging, 'feature.txt');
    git(merging, 'push', '-q', '-u', 'origin', 'feature');
    git(merging, 'switch', '-q', 'main');
    git(merging, ...author, 'merge', '-q', '--no-ff', '--no-commit', 'feature');
    const rebasing = unlistedProject(dir, 'rebasing');
    commit(rebasing);
    git(rebasing, 'push', '-q', 'origin', 'main');
    // Stops the rebase after its first step, with nothing else to report.
    try {
      git(
        rebasing,
        ...author,
        'rebase',
        '-q',
        '--force-rebase',
        '--exec',
        'false',
        'HEAD~1',
      );
    } catch {}

    const result = gitwork(['prune'], { cwd: dir });

    expect(result.stdout).toMatch(/merging +skipped: .*merging/);
    expect(result.stdout).toContain('rebasing  skipped: rebasing');
    expect(existsSync(merging)).toBe(true);
    expect(existsSync(rebasing)).toBe(true);
  });

  test('skips a Project with linked worktrees, whose work it cannot see', () => {
    const dir = emptyWorkspace();
    const old = unlistedProject(dir, 'old');
    git(old, 'worktree', 'add', '-q', '--detach', join(tempDir(), 'wt'));

    const result = gitwork(['prune'], { cwd: dir });

    expect(result.stdout).toContain('old  skipped: 1 linked worktree');
    expect(existsSync(old)).toBe(true);
  });

  test('works on the named Unlisted Projects only', () => {
    const dir = emptyWorkspace();
    const a = unlistedProject(dir, 'a');
    const b = unlistedProject(dir, 'b');

    const result = gitwork(['prune', 'b'], { cwd: dir });

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('a ');
    expect(existsSync(a)).toBe(true);
    expect(existsSync(b)).toBe(false);
  });

  test('exits 1 for a listed, unknown or non-git name, deleting nothing', () => {
    const { dir, project } = clonedApi();
    const old = unlistedProject(dir, 'old');
    mkdirSync(join(dir, 'projects', 'notes'));

    const listed = gitwork(['prune', 'old', 'api'], { cwd: dir });
    const unknown = gitwork(['prune', 'old', 'nope'], { cwd: dir });
    const plain = gitwork(['prune', 'notes'], { cwd: dir });

    expect(listed.code).toBe(1);
    expect(listed.stderr).toContain("'api' is in gitwork.yaml");
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("no Unlisted Project named 'nope'");
    expect(plain.code).toBe(1);
    expect(plain.stderr).toContain('projects/notes is not a git repository');
    expect(existsSync(project)).toBe(true);
    expect(existsSync(old)).toBe(true);
    expect(existsSync(join(dir, 'projects', 'notes'))).toBe(true);
  });

  test('never deletes folders that are not git repositories', () => {
    const dir = emptyWorkspace();
    mkdirSync(join(dir, 'projects', 'notes'), { recursive: true });

    const result = gitwork(['prune'], { cwd: dir });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('no Unlisted Projects to prune');
    expect(existsSync(join(dir, 'projects', 'notes'))).toBe(true);
  });

  test('--dry-run reports what would happen and deletes nothing', () => {
    const dir = emptyWorkspace();
    const clean = unlistedProject(dir, 'clean');
    const dirty = unlistedProject(dir, 'dirty');
    writeFileSync(join(dirty, 'new.txt'), 'x\n');

    const result = gitwork(['prune', '--dry-run'], { cwd: dir });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('clean  deleted');
    expect(result.stdout).toContain('dirty  skipped: dirty');
    expect(result.stdout).toContain('nothing was deleted');
    expect(existsSync(clean)).toBe(true);
    expect(existsSync(dirty)).toBe(true);
  });

  test('exits 1 when a Project fails, and moves on to the next', () => {
    const dir = emptyWorkspace();
    const a = unlistedProject(dir, 'a');
    ignore(a, 'build/');
    mkdirSync(join(a, 'build'));
    writeFileSync(join(a, 'build', 'out.js'), 'x\n');
    chmodSync(join(a, 'build'), 0o555);
    readOnly.push(join(a, 'build'));
    const b = unlistedProject(dir, 'b');

    const result = gitwork(['prune'], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/a {2}failed: /);
    expect(result.stdout).toContain('b  deleted');
    expect(result.stdout).toContain('1 deleted, 1 failed');
    expect(existsSync(b)).toBe(false);
  });

  test('only prune supports --dry-run', () => {
    const dir = emptyWorkspace();

    expect(gitwork(['sync', '--dry-run'], { cwd: dir }).stderr).toContain(
      "'sync' does not support --dry-run",
    );
  });
});
