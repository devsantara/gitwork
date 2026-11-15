import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vite-plus/test';

import {
  author,
  clonedApi,
  git,
  gitwork,
  remote,
  workspace,
} from './helpers.js';

const manifest = (dir: string) =>
  readFileSync(join(dir, 'gitwork.yaml'), 'utf8');

describe('gitwork remove', () => {
  test("removes the entry and leaves the Project's folder, now Unlisted", () => {
    const { dir, project } = clonedApi();
    const web = remote();
    writeFileSync(
      join(dir, 'gitwork.yaml'),
      `# Acme\n${manifest(dir)}  # The web app\n  web:\n    url: ${web}\n`,
    );

    const result = gitwork(['remove', 'api'], { cwd: dir });

    expect(result.code).toBe(0);
    expect(manifest(dir)).toBe(
      `# Acme\nversion: 1\nprojects:\n  # The web app\n  web:\n    url: ${web}\n`,
    );
    expect(existsSync(join(project, '.git'))).toBe(true);
    expect(result.stdout).toContain('Removed api from gitwork.yaml');
    expect(result.stdout).toContain('gitwork prune api');
    expect(result.stderr).toContain('unlisted: api');
    expect(gitwork(['check'], { cwd: dir }).code).toBe(0);
  });

  test('removes a Project that was never cloned', () => {
    const dir = workspace({ api: { url: remote() } });

    const result = gitwork(['remove', 'api'], { cwd: dir });

    expect(result.code).toBe(0);
    expect(manifest(dir)).toBe('version: 1\nprojects: {}\n');
    expect(result.stdout).not.toContain('prune');
    expect(result.stderr).toBe('');
  });

  test('exits 1 for a name the Manifest does not list', () => {
    const dir = workspace({ api: { url: remote() } });
    const before = manifest(dir);

    const result = gitwork(['remove', 'web'], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("no Project named 'web'");
    expect(manifest(dir)).toBe(before);
  });

  test('exits 1 without exactly one name', () => {
    const dir = workspace({ api: { url: remote() }, web: { url: remote() } });
    const before = manifest(dir);

    expect(gitwork(['remove'], { cwd: dir }).code).toBe(1);
    expect(gitwork(['remove', 'api', 'web'], { cwd: dir }).code).toBe(1);
    expect(gitwork(['remove', '--tag', 'x'], { cwd: dir }).code).toBe(1);
    expect(manifest(dir)).toBe(before);
  });

  test('never commits in the Workspace repository', () => {
    const { dir } = clonedApi();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, '.gitignore'), '/projects/\n');
    git(dir, 'add', '.');
    git(dir, ...author, 'commit', '-q', '-m', 'workspace');

    expect(gitwork(['remove', 'api'], { cwd: dir }).code).toBe(0);

    expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('1');
    expect(git(dir, 'status', '--porcelain')).toBe('M gitwork.yaml');
  });
});
