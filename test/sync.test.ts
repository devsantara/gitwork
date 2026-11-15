import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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

const cloned = (dir: string, name: string) =>
  existsSync(join(dir, 'projects', name, '.git'));

function tagged(): string {
  return workspace({
    storefront: { url: remote(), tags: ['frontend'] },
    api: { url: remote(), tags: ['backend'] },
    admin: { url: remote(), tags: ['frontend'] },
    docs: { url: remote() },
  });
}

describe('gitwork sync', () => {
  test('clones every Missing Project into projects/<name>', () => {
    const dir = workspace({ api: { url: remote() }, web: { url: remote() } });

    const result = gitwork(['sync'], { cwd: dir });

    expect(result.code).toBe(0);
    expect(cloned(dir, 'api')).toBe(true);
    expect(cloned(dir, 'web')).toBe(true);
    expect(result.stdout).toBe('api  cloned\nweb  cloned\n\n2 cloned\n');
  });

  test('clones the default branch with the Manifest URL as origin', () => {
    const url = remote('trunk');
    const dir = workspace({ api: { url } });

    gitwork(['sync'], { cwd: dir });

    const project = join(dir, 'projects', 'api');
    expect(git(project, 'branch', '--show-current')).toBe('trunk');
    expect(git(project, 'remote')).toBe('origin');
    expect(git(project, 'remote', 'get-url', 'origin')).toBe(url);
    expect(git(project, 'rev-parse', '--is-shallow-repository')).toBe('false');
  });

  test('reports an already cloned Project as unchanged', () => {
    const dir = workspace({ api: { url: remote() }, web: { url: remote() } });
    gitwork(['sync', 'api'], { cwd: dir });

    const result = gitwork(['sync'], { cwd: dir });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      'api  unchanged\nweb  cloned\n\n1 cloned, 1 unchanged\n',
    );
  });

  test('fails a folder that is not a git repository and leaves it untouched', () => {
    const dir = workspace({ api: { url: remote() } });
    const folder = join(dir, 'projects', 'api');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'notes.txt'), 'mine\n');

    const result = gitwork(['sync'], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe(
      'api  failed: not a git repository\n\n1 failed\n',
    );
    expect(readFileSync(join(folder, 'notes.txt'), 'utf8')).toBe('mine\n');
    expect(existsSync(join(folder, '.git'))).toBe(false);
  });

  test("fails a Project git cannot clone, with git's error, and carries on", () => {
    const missing = join(tempDir(), 'nowhere.git');
    const dir = workspace({
      api: { url: remote() },
      broken: { url: missing },
      web: { url: remote() },
    });

    const result = gitwork(['sync'], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe(
      'api     cloned\n' +
        `broken  failed: repository '${missing}' does not exist\n` +
        'web     cloned\n' +
        '\n2 cloned, 1 failed\n',
    );
    expect(cloned(dir, 'web')).toBe(true);
    expect(existsSync(join(dir, 'projects', 'broken'))).toBe(false);
  });

  test('prints results in Manifest order, however many Projects there are', () => {
    const names = Array.from({ length: 12 }, (_, i) => `p${i}`).toReversed();
    const dir = workspace(
      Object.fromEntries(names.map((name) => [name, { url: remote() }])),
    );

    const result = gitwork(['sync'], { cwd: dir });

    expect(result.code).toBe(0);
    const lines = result.stdout.split('\n').slice(0, names.length);
    expect(lines.map((line) => line.split(' ')[0])).toEqual(names);
  });

  test("names the remote origin even when the user's git config says otherwise", () => {
    const url = remote();
    const dir = workspace({ api: { url } });

    gitwork(['sync'], {
      cwd: dir,
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'clone.defaultRemoteName',
        GIT_CONFIG_VALUE_0: 'upstream',
      },
    });

    expect(git(join(dir, 'projects', 'api'), 'remote')).toBe('origin');
  });

  test('keeps the cause git reports before its fatal line, such as an ssh error', () => {
    const bin = tempDir();
    const script = `#!/bin/sh
case "$1" in
  --version) echo "git version 2.40.0" ;;
  clone)
    echo "Cloning into 'projects/api'..." >&2
    echo "git@x: Permission denied (publickey)." >&2
    echo "fatal: Could not read from remote repository." >&2
    echo "" >&2
    echo "Please make sure you have the correct access rights" >&2
    exit 128 ;;
esac
`;
    writeFileSync(join(bin, 'git'), script, { mode: 0o755 });
    const dir = workspace({ api: { url: 'git@x:api.git' } });

    const result = gitwork(['sync'], {
      cwd: dir,
      env: { PATH: `${bin}:/usr/bin:/bin` },
    });

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      'api  failed: git@x: Permission denied (publickey). Could not read from remote repository.\n',
    );
  });

  test('refuses to run when projects/ is a symlink, cloning nothing', () => {
    const dir = workspace({ api: { url: remote() } });
    const elsewhere = tempDir();
    symlinkSync(elsewhere, join(dir, 'projects'));

    const result = gitwork(['sync'], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      'gitwork: projects must be a directory, not a symlink\n',
    );
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  test('works on up to 8 Projects at once', () => {
    // A fake git whose clones take a while and note how many are running.
    const bin = tempDir();
    mkdirSync(join(bin, 'running'));
    const script = `#!/bin/sh
case "$1" in
  --version) echo "git version 2.40.0" ;;
  clone)
    touch "${bin}/running/$$"
    sleep 0.5
    ls "${bin}/running" | wc -l >> "${bin}/counts"
    rm "${bin}/running/$$"
    mkdir -p "$6/.git" ;;
esac
`;
    writeFileSync(join(bin, 'git'), script, { mode: 0o755 });
    const names = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const dir = workspace(
      Object.fromEntries(names.map((name) => [name, { url: `git@x:${name}` }])),
    );

    const result = gitwork(['sync'], {
      cwd: dir,
      env: { PATH: `${bin}:/usr/bin:/bin` },
    });

    expect(result.code).toBe(0);
    const counts = readFileSync(join(bin, 'counts'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(Number);
    expect(Math.max(...counts)).toBe(8);
  });

  test('--json prints the result of each Project', () => {
    const missing = join(tempDir(), 'nowhere.git');
    const dir = workspace({ api: { url: remote() }, broken: { url: missing } });

    const result = gitwork(['sync', '--json'], { cwd: dir });

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      projects: [
        { name: 'api', outcome: 'cloned', states: [] },
        {
          name: 'broken',
          outcome: 'failed',
          states: [],
          error: `repository '${missing}' does not exist`,
        },
      ],
    });
  });

  test("never touches the Workspace's own repository", () => {
    const dir = workspace({ api: { url: remote() } });
    writeFileSync(join(dir, '.gitignore'), '/projects/\n');
    git(dir, 'init', '-q');
    const before = git(dir, 'status', '--porcelain', '--ignored');

    gitwork(['sync'], { cwd: dir });

    expect(cloned(dir, 'api')).toBe(true);
    expect(git(dir, 'status', '--porcelain')).toBe(
      before
        .split('\n')
        .filter((line) => !line.startsWith('!!'))
        .join('\n'),
    );
    expect(git(dir, 'remote')).toBe('');
  });
});

const syncOf = (dir: string, ...args: string[]) =>
  gitwork(['sync', ...args], { cwd: dir });

const head = (project: string, ref = 'HEAD') => git(project, 'rev-parse', ref);

describe('gitwork sync: updating cloned Projects', () => {
  test('fast-forwards a clean Project that is behind', () => {
    const { dir, url, project } = clonedApi();
    pushFromElsewhere(url);
    pushFromElsewhere(url);

    const result = syncOf(dir);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('api  updated\n\n1 updated\n');
    expect(head(project)).toBe(head(project, 'origin/main'));
    expect(existsSync(join(project, 'elsewhere.txt'))).toBe(true);
    expect(git(project, 'rev-list', '--merges', '--count', 'HEAD')).toBe('0');
  });

  test('fetches every remote, not only origin', () => {
    const { dir, project } = clonedApi();
    const other = remote();
    git(project, 'remote', 'add', 'fork', other);
    pushFromElsewhere(other);

    syncOf(dir);

    expect(head(project, 'fork/main')).toBe(head(other, 'main'));
  });

  test('reports an up-to-date Project as unchanged', () => {
    const { dir } = clonedApi();

    const result = syncOf(dir);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('api  unchanged\n\n1 unchanged\n');
  });

  test('leaves a Project that is only ahead unchanged', () => {
    const { dir, project } = clonedApi();
    commit(project);

    expect(syncOf(dir).stdout).toBe('api  unchanged: ahead 1\n\n1 unchanged\n');
  });

  test('leaves a branch that was never pushed unchanged', () => {
    const { dir, project } = clonedApi();
    git(project, 'switch', '-q', '-c', 'spike');

    expect(syncOf(dir).stdout).toBe(
      'api  unchanged: no upstream\n\n1 unchanged\n',
    );
  });

  test('drops deleted remote branches, leaving a gone branch unchanged', () => {
    const { dir, url, project } = clonedApi();
    git(project, 'switch', '-q', '-c', 'feature');
    git(project, 'push', '-q', '-u', 'origin', 'feature');
    git(url, 'branch', '-D', 'feature');

    const result = syncOf(dir);

    expect(result.stdout).toBe('api  unchanged: gone\n\n1 unchanged\n');
    expect(git(project, 'branch', '-r')).not.toContain('origin/feature');
  });

  test('skips a Dirty Project that is behind, without changing its exit code', () => {
    const { dir, url, project } = clonedApi();
    pushFromElsewhere(url);
    writeFileSync(join(project, 'notes.txt'), 'mine\n');
    const before = head(project);

    const result = syncOf(dir);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('api  skipped: behind 1, dirty\n\n1 skipped\n');
    expect(head(project)).toBe(before);
    expect(readFileSync(join(project, 'notes.txt'), 'utf8')).toBe('mine\n');
  });

  test('counts untracked files as Dirty even when git config hides them', () => {
    const { dir, url, project } = clonedApi();
    git(project, 'config', 'status.showUntrackedFiles', 'no');
    pushFromElsewhere(url);
    writeFileSync(join(project, 'notes.txt'), 'mine\n');

    expect(syncOf(dir).stdout).toBe(
      'api  skipped: behind 1, dirty\n\n1 skipped\n',
    );
  });

  test('a Dirty Project that is not behind is unchanged', () => {
    const { dir, project } = clonedApi();
    writeFileSync(join(project, 'notes.txt'), 'mine\n');

    expect(syncOf(dir).stdout).toBe('api  unchanged: dirty\n\n1 unchanged\n');
  });

  test('skips a diverged Project, never merging or rebasing', () => {
    const { dir, url, project } = clonedApi();
    commit(project);
    pushFromElsewhere(url);
    const before = head(project);

    const result = syncOf(dir);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('api  skipped: diverged\n\n1 skipped\n');
    expect(head(project)).toBe(before);
  });

  test('skips a detached HEAD', () => {
    const { dir, url, project } = clonedApi();
    git(project, 'switch', '-q', '--detach');
    pushFromElsewhere(url);
    const before = head(project);

    expect(syncOf(dir).stdout).toBe('api  skipped: detached\n\n1 skipped\n');
    expect(head(project)).toBe(before);
  });

  test.each([
    ['merge', 'skipped: ahead 1, dirty, merging'],
    ['rebase', 'skipped: dirty, rebasing'],
  ])('skips a %s in progress', (command, line) => {
    const { dir, project } = clonedApi();
    // Two branches that change the same line, so combining them stops.
    git(project, 'switch', '-q', '-c', 'other');
    writeFileSync(join(project, 'README.md'), 'other\n');
    git(project, ...author, 'commit', '-q', '-am', 'other');
    git(project, 'switch', '-q', 'main');
    writeFileSync(join(project, 'README.md'), 'main\n');
    git(project, ...author, 'commit', '-q', '-am', 'main');
    expect(() => git(project, ...author, command, '-q', 'other')).toThrow(
      'Command failed',
    );

    const result = syncOf(dir);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`api  ${line}\n\n1 skipped\n`);
  });

  test('fast-forwards the default branch when another branch is checked out, even if Dirty', () => {
    const { dir, url, project } = clonedApi();
    git(project, 'switch', '-q', '-c', 'spike');
    writeFileSync(join(project, 'notes.txt'), 'mine\n');
    pushFromElsewhere(url);

    const result = syncOf(dir);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      'api  unchanged: no upstream, dirty, main updated\n\n1 unchanged\n',
    );
    expect(head(project, 'main')).toBe(head(project, 'origin/main'));
    expect(git(project, 'branch', '--show-current')).toBe('spike');
    expect(existsSync(join(project, 'elsewhere.txt'))).toBe(false);
    expect(readFileSync(join(project, 'notes.txt'), 'utf8')).toBe('mine\n');
  });

  test('leaves the default branch alone when it has commits of its own', () => {
    const { dir, url, project } = clonedApi();
    commit(project);
    git(project, 'switch', '-q', '-c', 'spike');
    pushFromElsewhere(url);
    const before = head(project, 'main');

    expect(syncOf(dir).stdout).toBe(
      'api  unchanged: no upstream\n\n1 unchanged\n',
    );
    expect(head(project, 'main')).toBe(before);
  });

  test('leaves the default branch alone when it is checked out in another worktree', () => {
    const { dir, url, project } = clonedApi();
    git(project, 'switch', '-q', '-c', 'spike');
    git(project, 'worktree', 'add', '-q', join(tempDir(), 'main'), 'main');
    pushFromElsewhere(url);
    const before = head(project, 'main');

    expect(syncOf(dir).stdout).toBe(
      'api  unchanged: no upstream\n\n1 unchanged\n',
    );
    expect(head(project, 'main')).toBe(before);
  });

  test('leaves the default branch alone while another worktree has a detached HEAD', () => {
    const { dir, url, project } = clonedApi();
    git(project, 'switch', '-q', '-c', 'spike');
    git(project, 'worktree', 'add', '-q', '--detach', join(tempDir(), 'wt'));
    pushFromElsewhere(url);
    const before = head(project, 'main');

    syncOf(dir);

    expect(head(project, 'main')).toBe(before);
  });

  test('skips the default-branch step when the default branch cannot be determined', () => {
    const { dir, url, project } = clonedApi();
    git(project, 'switch', '-q', '-c', 'spike');
    git(project, 'remote', 'set-head', 'origin', '--delete');
    // Newer git would otherwise record it again on the next fetch.
    git(project, 'config', 'remote.origin.followRemoteHEAD', 'never');
    pushFromElsewhere(url);
    const before = head(project, 'main');

    const result = syncOf(dir);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('api  unchanged: no upstream\n\n1 unchanged\n');
    expect(head(project, 'main')).toBe(before);
  });

  test('warns about a url mismatch but still follows the configured upstream', () => {
    const { dir, project } = clonedApi();
    const moved = remote();
    git(project, 'remote', 'set-url', 'origin', moved);
    git(project, 'fetch', '-q', 'origin');
    git(project, 'reset', '-q', '--hard', 'origin/main');
    pushFromElsewhere(moved);

    const result = syncOf(dir);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('api  updated: url mismatch\n\n1 updated\n');
    expect(result.stderr).toBe(
      "api: origin is not the url in gitwork.yaml; sync still follows the branch's upstream\n",
    );
    expect(head(project)).toBe(head(moved, 'main'));
    expect(git(project, 'remote', 'get-url', 'origin')).toBe(moved);
  });

  test("fails a Project whose fetch fails, with git's error, and carries on", () => {
    const missing = join(tempDir(), 'nowhere.git');
    const dir = workspace({ api: { url: remote() }, web: { url: remote() } });
    syncOf(dir);
    git(join(dir, 'projects', 'api'), 'remote', 'set-url', 'origin', missing);

    const result = syncOf(dir, '--json');

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).projects).toEqual([
      expect.objectContaining({ name: 'api', outcome: 'failed' }),
      { name: 'web', outcome: 'unchanged', states: [] },
    ]);
  });

  test("--json includes each Project's outcome and states", () => {
    const urls = { api: remote(), web: remote() };
    const dir = workspace({ api: { url: urls.api }, web: { url: urls.web } });
    syncOf(dir);
    pushFromElsewhere(urls.api);
    pushFromElsewhere(urls.web);
    writeFileSync(join(dir, 'projects', 'web', 'notes.txt'), 'mine\n');

    const result = syncOf(dir, '--json');

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      projects: [
        { name: 'api', outcome: 'updated', states: [] },
        { name: 'web', outcome: 'skipped', states: ['behind 1', 'dirty'] },
      ],
    });
  });
});

describe('Selection', () => {
  test('names and --tag select every Project that matches any of them', () => {
    const dir = tagged();

    const result = gitwork(['sync', 'docs', '--tag', 'backend'], { cwd: dir });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('api   cloned\ndocs  cloned\n\n2 cloned\n');
  });

  test('--tag can be repeated', () => {
    const dir = tagged();

    gitwork(['sync', '--tag', 'frontend', '--tag', 'backend'], { cwd: dir });

    expect(cloned(dir, 'storefront')).toBe(true);
    expect(cloned(dir, 'api')).toBe(true);
    expect(cloned(dir, 'admin')).toBe(true);
    expect(cloned(dir, 'docs')).toBe(false);
  });

  test('an unknown name exits 1 before any work starts', () => {
    const dir = tagged();

    const result = gitwork(['sync', 'api', 'nope'], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "gitwork: no Project named 'nope' in gitwork.yaml\n",
    );
    expect(existsSync(join(dir, 'projects'))).toBe(false);
  });

  test('a Tag no Project carries exits 1 before any work starts', () => {
    const dir = tagged();

    const result = gitwork(['sync', '--tag', 'mobile'], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("gitwork: no Project has the Tag 'mobile'\n");
    expect(existsSync(join(dir, 'projects'))).toBe(false);
  });

  test('the current directory never changes the Selection', () => {
    const dir = tagged();
    gitwork(['sync', 'api'], { cwd: dir });

    const result = gitwork(['sync'], { cwd: join(dir, 'projects', 'api') });

    expect(result.code).toBe(0);
    expect(cloned(dir, 'storefront')).toBe(true);
    expect(cloned(dir, 'docs')).toBe(true);
  });

  test('--tag is refused by commands that take no Selection', () => {
    const result = gitwork(['check', '--tag', 'web'], { cwd: tempDir() });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("'check' does not support --tag");
  });
});
