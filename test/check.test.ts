import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vite-plus/test';

import { fakeGitPath, gitwork, tempDir } from './helpers.js';

const VALID = 'version: 1\nprojects:\n  api:\n    url: git@x:api.git\n';
const INVALID =
  'version: 2\nprojects:\n  api:\n    url: git@x:api.git\n    branch: main\n';

function workspace(manifest: string): string {
  const dir = tempDir();
  writeFileSync(join(dir, 'gitwork.yaml'), manifest);
  return dir;
}

describe('gitwork check', () => {
  test('exits 0 and says so when the Manifest is valid', () => {
    const result = gitwork(['check'], { cwd: workspace(VALID) });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('gitwork.yaml is valid');
    expect(result.stderr).toBe('');
  });

  test('reports every error with its line number and exits 1', () => {
    const result = gitwork(['check'], { cwd: workspace(INVALID) });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "gitwork.yaml:1: 'version' must be 1\n" +
        "gitwork.yaml:5: unknown key 'branch' in Project 'api'\n" +
        'gitwork: gitwork.yaml has 2 errors\n',
    );
  });

  test('--json prints a valid result', () => {
    const dir = workspace(VALID);

    const result = gitwork(['check', '--json'], { cwd: dir });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      manifest: join(dir, 'gitwork.yaml'),
      valid: true,
      errors: [],
    });
  });

  test('--json prints the errors and exits 1', () => {
    const dir = workspace(INVALID);

    const result = gitwork(['check', '--json'], { cwd: dir });

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      manifest: join(dir, 'gitwork.yaml'),
      valid: false,
      errors: [
        { line: 1, message: "'version' must be 1" },
        { line: 5, message: "unknown key 'branch' in Project 'api'" },
      ],
    });
    expect(result.stderr).toBe('');
  });

  test('works offline: it runs git only to check its version', () => {
    const path = fakeGitPath('2.40.0');

    const result = gitwork(['check'], {
      cwd: workspace(VALID),
      env: { PATH: path },
    });

    expect(result.code).toBe(0);
    expect(readFileSync(join(path, 'calls.log'), 'utf8')).toMatch(
      /^--version [^\n]*\n$/,
    );
  });

  test('exits 1 when given arguments', () => {
    const result = gitwork(['check', 'api'], { cwd: workspace(VALID) });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('takes no arguments');
  });
});

describe('Workspace discovery', () => {
  test('finds gitwork.yaml in a parent directory', () => {
    const dir = workspace(VALID);
    const nested = join(dir, 'projects', 'api', 'src');
    mkdirSync(nested, { recursive: true });

    const result = gitwork(['check'], { cwd: nested });

    expect(result.code).toBe(0);
  });

  test('reports errors with the path to the Manifest it found', () => {
    const dir = workspace(INVALID);
    const nested = join(dir, 'docs');
    mkdirSync(nested);

    const result = gitwork(['check'], { cwd: nested });

    expect(result.stderr).toContain("../gitwork.yaml:1: 'version' must be 1");
  });

  test('uses the nearest gitwork.yaml', () => {
    const outer = workspace(INVALID);
    const inner = join(outer, 'inner');
    mkdirSync(inner);
    writeFileSync(join(inner, 'gitwork.yaml'), VALID);

    const result = gitwork(['check'], { cwd: inner });

    expect(result.code).toBe(0);
  });

  test('-C <dir> starts the search from <dir>', () => {
    const dir = workspace(VALID);
    const nested = join(dir, 'docs');
    mkdirSync(nested);

    const result = gitwork(['-C', nested, 'check'], { cwd: tempDir() });

    expect(result.code).toBe(0);
  });

  test('ignores a directory named gitwork.yaml', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'gitwork.yaml'));

    const result = gitwork(['check'], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('not in a gitwork workspace');
  });

  test('outside a Workspace, exits 1 with "not in a gitwork workspace"', () => {
    const result = gitwork(['check'], { cwd: tempDir() });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      'gitwork: not in a gitwork workspace (no gitwork.yaml here or in any parent directory)\n',
    );
  });

  test('an unknown command is reported as such, even outside a Workspace', () => {
    const result = gitwork(['frobnicate'], { cwd: tempDir() });

    expect(result.stderr).toContain("unknown command 'frobnicate'");
  });
});

describe('--json', () => {
  test('is refused by commands that do not support it', () => {
    const dir = tempDir();

    const result = gitwork(['init', '--json'], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("'init' does not support --json");
  });
});
