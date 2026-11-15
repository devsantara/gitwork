import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vite-plus/test';

import {
  author,
  clonedApi,
  commit,
  git,
  gitwork,
  pushFromElsewhere,
  remote,
  tempDir,
  workspace,
} from './helpers.js';

/** A Workspace listing `api`, with the Unlisted Projects `old-api` and `my-tool` cloned beside it. */
function withUnlisted(): string {
  const { dir } = clonedApi();
  for (const name of ['old-api', 'my-tool'])
    git(dir, 'clone', '-q', remote(), join('projects', name));
  return dir;
}

const statusOf = (dir: string, ...args: string[]) =>
  gitwork(['status', ...args], { cwd: dir });

describe('gitwork status', () => {
  test('shows each Project with its branch and states, in Manifest order', () => {
    const dir = workspace({ web: { url: remote() }, api: { url: remote() } });
    gitwork(['sync', 'web'], { cwd: dir });

    const result = statusOf(dir);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('web  main  up to date\napi        missing\n');
    expect(result.stderr).toBe('');
  });

  test('is offline by default: a new remote commit is not seen', () => {
    const { dir, url } = clonedApi();
    pushFromElsewhere(url);

    expect(statusOf(dir).stdout).toBe('api  main  up to date\n');
  });

  test('--fetch fetches first, so the Project is behind', () => {
    const { dir, url } = clonedApi();
    pushFromElsewhere(url);
    pushFromElsewhere(url);

    const result = statusOf(dir, '--fetch');

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('api  main  behind 2\n');
  });

  test('ahead N', () => {
    const { dir, project } = clonedApi();
    commit(project);

    expect(statusOf(dir).stdout).toBe('api  main  ahead 1\n');
  });

  test('diverged', () => {
    const { dir, url, project } = clonedApi();
    commit(project);
    pushFromElsewhere(url);

    expect(statusOf(dir, '--fetch').stdout).toBe('api  main  diverged\n');
  });

  test('no upstream', () => {
    const { dir, project } = clonedApi();
    git(project, 'switch', '-q', '-c', 'spike');

    expect(statusOf(dir).stdout).toBe('api  spike  no upstream\n');
  });

  test('gone: --fetch drops the deleted upstream branch', () => {
    const { dir, url, project } = clonedApi();
    git(project, 'switch', '-q', '-c', 'feature');
    git(project, 'push', '-q', '-u', 'origin', 'feature');
    git(url, 'branch', '-D', 'feature');

    const result = statusOf(dir, '--fetch');

    expect(result.stdout).toBe('api  feature  gone\n');
    expect(git(project, 'branch', '-r')).not.toContain('origin/feature');
  });

  test('detached', () => {
    const { dir, project } = clonedApi();
    git(project, 'switch', '-q', '--detach');

    expect(statusOf(dir).stdout).toBe('api  detached\n');
  });

  test('dirty counts untracked files but not ignored ones', () => {
    const { dir, project } = clonedApi();
    writeFileSync(join(project, '.git', 'info', 'exclude'), '.env\n');
    writeFileSync(join(project, '.env'), 'SECRET=1\n');

    expect(statusOf(dir).stdout).toBe('api  main  up to date\n');

    writeFileSync(join(project, 'notes.txt'), 'mine\n');

    expect(statusOf(dir).stdout).toBe('api  main  up to date, dirty\n');
  });

  test.each([
    ['merging', 'main', 'ahead 1, dirty, merging'],
    ['rebasing', '', 'dirty, rebasing'],
  ])('%s', (operation, branch, states) => {
    const { dir, project } = clonedApi();
    // Two branches that change the same line, so combining them stops.
    git(project, 'switch', '-q', '-c', 'other');
    writeFileSync(join(project, 'README.md'), 'other\n');
    git(project, ...author, 'commit', '-q', '-am', 'other');
    git(project, 'switch', '-q', 'main');
    writeFileSync(join(project, 'README.md'), 'main\n');
    git(project, ...author, 'commit', '-q', '-am', 'main');
    const command = operation === 'merging' ? 'merge' : 'rebase';
    expect(() => git(project, ...author, command, '-q', 'other')).toThrow(
      'Command failed',
    );

    const columns = branch === '' ? ['api'] : ['api', branch];
    expect(statusOf(dir).stdout).toBe(`${[...columns, states].join('  ')}\n`);
  });

  test('url mismatch when origin differs from the Manifest URL', () => {
    const { dir, project } = clonedApi();
    git(project, 'remote', 'set-url', 'origin', remote());

    expect(statusOf(dir).stdout).toBe('api  main  up to date, url mismatch\n');
  });

  test('highlights a branch other than the remote default', () => {
    const { dir, project } = clonedApi();
    git(project, 'switch', '-q', '-c', 'spike');

    const result = gitwork(['status'], {
      cwd: dir,
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    expect(result.stdout).toBe('api  \u001b[33mspike\u001b[39m  no upstream\n');
  });

  test('a listed folder that is not a git repository failed and is untouched', () => {
    const dir = workspace({ api: { url: remote() } });
    mkdirSync(join(dir, 'projects', 'api'), { recursive: true });
    writeFileSync(join(dir, 'projects', 'api', 'notes.txt'), 'mine\n');

    const result = statusOf(dir);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('api  failed: not a git repository\n');
    expect(
      readFileSync(join(dir, 'projects', 'api', 'notes.txt'), 'utf8'),
    ).toBe('mine\n');
  });

  test('--json prints the rows', () => {
    const { dir, project } = clonedApi();
    commit(project);

    const result = statusOf(dir, '--json');

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      projects: [
        {
          name: 'api',
          branch: 'main',
          defaultBranch: 'main',
          states: ['ahead 1'],
        },
      ],
    });
  });

  test('--fetch is refused by other commands', () => {
    const result = gitwork(['check', '--fetch'], { cwd: tempDir() });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("'check' does not support --fetch");
  });
});

describe('Unlisted Projects', () => {
  const WARNING =
    'unlisted: my-tool, old-api (gitwork prune deletes them; gitwork add <name> lists one)\n';

  test('appear as unlisted rows after the listed ones when no Selection is given', () => {
    const dir = withUnlisted();

    const result = statusOf(dir);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      'api      main  up to date\n' +
        'my-tool  main  unlisted, up to date\n' +
        'old-api  main  unlisted, up to date\n',
    );
    expect(result.stderr).toBe(WARNING);
  });

  test('get no rows when a Selection is given', () => {
    const dir = withUnlisted();

    expect(statusOf(dir, 'api').stdout).toBe('api  main  up to date\n');
  });

  test.each([['status'], ['sync'], ['check'], ['status', '--json']])(
    '`%s` ends with one warning listing them',
    (...args) => {
      const dir = withUnlisted();

      const result = gitwork(args, { cwd: dir });

      expect(result.code).toBe(0);
      expect(result.stderr).toBe(WARNING);
      expect(result.stdout).not.toContain('unlisted:');
    },
  );

  test('the warning still ends the output when the command fails', () => {
    const dir = withUnlisted();

    const result = statusOf(dir, 'old-api');

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "gitwork: 'old-api' is unlisted; run 'gitwork add old-api' to list it.\n" +
        WARNING,
    );
  });

  test('--fetch never fetches them', () => {
    const dir = withUnlisted();
    const tool = join(dir, 'projects', 'my-tool');
    pushFromElsewhere(git(tool, 'remote', 'get-url', 'origin'));
    const before = git(tool, 'rev-parse', 'origin/main');

    statusOf(dir, '--fetch');

    expect(git(tool, 'rev-parse', 'origin/main')).toBe(before);
  });

  test('no warning when there are none', () => {
    const { dir } = clonedApi();

    expect(gitwork(['sync'], { cwd: dir }).stderr).toBe('');
  });

  test('folders that are not git repositories are reported on stderr and left alone', () => {
    const { dir } = clonedApi();
    mkdirSync(join(dir, 'projects', 'scratch'));
    writeFileSync(join(dir, 'projects', 'scratch', 'notes.txt'), 'mine\n');
    writeFileSync(join(dir, 'projects', '.DS_Store'), '');

    const result = statusOf(dir);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('api  main  up to date\n');
    expect(result.stderr).toBe(
      'projects/scratch is not a git repository; gitwork leaves it alone\n',
    );
    expect(
      readFileSync(join(dir, 'projects', 'scratch', 'notes.txt'), 'utf8'),
    ).toBe('mine\n');
  });
});
