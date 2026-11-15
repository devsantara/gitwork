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

import { git, gitwork, remote, tempDir, workspace } from './helpers.js';

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
        { name: 'api', outcome: 'cloned' },
        {
          name: 'broken',
          outcome: 'failed',
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
