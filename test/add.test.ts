import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vite-plus/test';

import {
  author,
  commit,
  git,
  gitwork,
  remote,
  tempDir,
  workspace,
} from './helpers.js';

const manifest = (dir: string) =>
  readFileSync(join(dir, 'gitwork.yaml'), 'utf8');

/** A remote at `<tmp>/<name>.git`, so its URL ends the way a real one does. */
function namedRemote(name: string): string {
  const url = join(tempDir(), `${name}.git`);
  git(tempDir(), 'clone', '-q', '--bare', remote(), url);
  return url;
}

/** A Workspace as `gitwork init` makes it, listing no Projects. */
function emptyWorkspace(): string {
  const dir = tempDir();
  gitwork(['init'], { cwd: dir });
  return dir;
}

describe('gitwork add <url>', () => {
  test('clones the Project, then lists it under the name from its URL', () => {
    const url = namedRemote('api');
    const dir = emptyWorkspace();

    const result = gitwork(['add', url], { cwd: dir });

    expect(result.code).toBe(0);
    expect(
      git(join(dir, 'projects', 'api'), 'remote', 'get-url', 'origin'),
    ).toBe(url);
    expect(manifest(dir)).toBe(
      `version: 1\nprojects:\n  api:\n    url: ${url}\n`,
    );
    expect(gitwork(['check'], { cwd: dir }).code).toBe(0);
  });

  test('lists it under an explicit name, with Tags and a description', () => {
    const url = namedRemote('api');
    const dir = emptyWorkspace();

    const result = gitwork(
      [
        'add',
        url,
        'backend-api',
        '--tag',
        'backend',
        '--tag',
        'go',
        '--description',
        'Public API: v2',
      ],
      { cwd: dir },
    );

    expect(result.code).toBe(0);
    expect(existsSync(join(dir, 'projects', 'backend-api', '.git'))).toBe(true);
    expect(manifest(dir)).toBe(
      [
        'version: 1',
        'projects:',
        '  backend-api:',
        `    url: ${url}`,
        '    description: "Public API: v2"',
        '    tags: [backend, go]',
        '',
      ].join('\n'),
    );
    expect(gitwork(['check'], { cwd: dir }).code).toBe(0);
  });

  test('names the Project after the URL without .git or a trailing slash', () => {
    const url = namedRemote('web');
    const dir = emptyWorkspace();

    expect(gitwork(['add', `${url}/`], { cwd: dir }).code).toBe(0);

    expect(manifest(dir)).toContain('  web:\n');
  });

  test("keeps the Manifest's comments and formatting", () => {
    const url = namedRemote('web');
    const dir = workspace({ api: { url: remote() } });
    const before = `# Acme\n${manifest(dir)}\n# end\n`;
    writeFileSync(join(dir, 'gitwork.yaml'), before);

    gitwork(['add', url, '--no-clone'], { cwd: dir });

    expect(manifest(dir)).toBe(
      before.replace('\n\n# end', `\n  web:\n    url: ${url}\n\n# end`),
    );
  });

  test('exits 1 and asks for a name when the URL gives an invalid one', () => {
    const url = namedRemote('MyApi');
    const dir = emptyWorkspace();

    const result = gitwork(['add', url], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`gitwork add ${url} <name>`);
    expect(manifest(dir)).toBe('version: 1\nprojects: {}\n');
    expect(existsSync(join(dir, 'projects'))).toBe(false);
  });

  test('exits 1 and asks for a name when the name is taken', () => {
    const dir = workspace({ api: { url: remote() } });
    const before = manifest(dir);

    const result = gitwork(['add', namedRemote('api')], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("a Project named 'api' is already");
    expect(result.stderr).toContain('<name>');
    expect(manifest(dir)).toBe(before);
    expect(existsSync(join(dir, 'projects'))).toBe(false);
  });

  test('exits 1 for an invalid explicit name', () => {
    const dir = emptyWorkspace();

    const result = gitwork(['add', namedRemote('api'), 'Api'], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("invalid Project name 'Api'");
  });

  test('exits 1 when another Project already has the URL', () => {
    const url = remote();
    const dir = workspace({ api: { url } });

    const result = gitwork(['add', url, 'other'], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Project 'api'");
  });

  test('a URL that cannot be cloned never reaches the Manifest', () => {
    const dir = emptyWorkspace();
    const url = join(tempDir(), 'nope.git');

    const result = gitwork(['add', url], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`could not clone ${url}`);
    expect(manifest(dir)).toBe('version: 1\nprojects: {}\n');
    expect(existsSync(join(dir, 'projects', 'nope'))).toBe(false);
  });

  test('--no-clone lists the Project without cloning it', () => {
    const dir = emptyWorkspace();
    const url = 'git@github.com:acme/api.git';

    const result = gitwork(['add', url, '--no-clone'], { cwd: dir });

    expect(result.code).toBe(0);
    expect(manifest(dir)).toContain(`  api:\n    url: ${url}\n`);
    expect(existsSync(join(dir, 'projects', 'api'))).toBe(false);
  });

  test('adopts projects/<name> without cloning when its origin is the URL', () => {
    const url = namedRemote('api');
    const dir = emptyWorkspace();
    const project = join(dir, 'projects', 'api');
    mkdirSync(join(dir, 'projects'));
    git(dir, 'clone', '-q', url, project);
    commit(project, 'mine.txt');

    const result = gitwork(['add', url], { cwd: dir });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('adopting');
    expect(existsSync(join(project, 'mine.txt'))).toBe(true);
    expect(manifest(dir)).toContain(`  api:\n    url: ${url}\n`);
    expect(result.stderr).not.toContain('unlisted');
  });

  test('exits 1 when the origin of projects/<name> is another URL', () => {
    const dir = emptyWorkspace();
    mkdirSync(join(dir, 'projects'));
    git(dir, 'clone', '-q', remote(), join(dir, 'projects', 'api'));

    const result = gitwork(['add', namedRemote('api')], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('projects/api already exists');
    expect(manifest(dir)).toBe('version: 1\nprojects: {}\n');
  });

  test('exits 1 when projects/<name> is not a git repository', () => {
    const dir = emptyWorkspace();
    mkdirSync(join(dir, 'projects', 'api'), { recursive: true });

    const result = gitwork(['add', namedRemote('api')], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('not a git repository');
    expect(manifest(dir)).toBe('version: 1\nprojects: {}\n');
  });

  test('never commits in the Workspace repository', () => {
    const dir = emptyWorkspace();
    git(dir, 'init', '-q');
    git(dir, 'add', '.');
    git(dir, ...author, 'commit', '-q', '-m', 'workspace');

    gitwork(['add', namedRemote('api')], { cwd: dir });

    expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('1');
    expect(git(dir, 'status', '--porcelain')).toBe('M gitwork.yaml');
  });
});

describe('gitwork add <name>', () => {
  test('lists an Unlisted Project, with its origin as the URL', () => {
    const url = remote();
    const dir = emptyWorkspace();
    mkdirSync(join(dir, 'projects'));
    git(dir, 'clone', '-q', url, join(dir, 'projects', 'my-tool'));

    const result = gitwork(['add', 'my-tool', '--tag', 'tools'], { cwd: dir });

    expect(result.code).toBe(0);
    expect(manifest(dir)).toBe(
      `version: 1\nprojects:\n  my-tool:\n    url: ${url}\n    tags: [tools]\n`,
    );
    expect(result.stderr).not.toContain('unlisted');
    expect(gitwork(['status'], { cwd: dir }).stdout).toContain('up to date');
  });

  test('exits 1 when there is no such Unlisted Project', () => {
    const dir = emptyWorkspace();

    const result = gitwork(['add', 'my-tool'], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("no Unlisted Project named 'my-tool'");
  });

  test('exits 1 when the Unlisted Project has no origin', () => {
    const dir = emptyWorkspace();
    const project = join(dir, 'projects', 'my-tool');
    mkdirSync(project, { recursive: true });
    git(project, 'init', '-q');

    const result = gitwork(['add', 'my-tool'], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("no 'origin' remote");
    expect(manifest(dir)).toBe('version: 1\nprojects: {}\n');
  });
});

describe('add options', () => {
  test('other commands refuse --no-clone and --description', () => {
    const dir = emptyWorkspace();

    expect(gitwork(['sync', '--no-clone'], { cwd: dir }).stderr).toContain(
      "'sync' does not support --no-clone",
    );
    expect(
      gitwork(['status', '--description', 'x'], { cwd: dir }).stderr,
    ).toContain("'status' does not support --description");
  });
});
