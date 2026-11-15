import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vite-plus/test';

import { clonedApi, gitwork, remote, workspace } from './helpers.js';

const execIn = (dir: string, ...args: string[]) =>
  gitwork(['exec', ...args], { cwd: dir });

/** A Workspace listing `api`, `web` and `docs`, with `api` and `web` cloned. */
function threeListed(): string {
  const dir = workspace({
    api: { url: remote(), tags: ['backend'] },
    web: { url: remote(), tags: ['frontend'] },
    docs: { url: remote() },
  });
  gitwork(['sync', 'api', 'web'], { cwd: dir });
  return dir;
}

describe('gitwork exec', () => {
  test('runs the command through the shell in projects/<name>', () => {
    const { dir, project } = clonedApi();

    const result = execIn(dir, '--', 'pwd && echo hi');

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      `==> api <==\n${project}\nhi\n\napi  ok\n\n1 ok\n`,
    );
    expect(result.stderr).toBe('');
  });

  test('joins the words after -- into one shell command', () => {
    const { dir } = clonedApi();

    const result = execIn(dir, '--', 'echo', 'a  b', '|', 'tr', 'a', 'x');

    expect(result.stdout).toBe('==> api <==\nx b\n\napi  ok\n\n1 ok\n');
  });

  test('runs one Project at a time, in Manifest order; Missing ones are skipped', () => {
    const dir = threeListed();

    // Each command sees the file the one before it left as it finished.
    const result = execIn(
      dir,
      '--',
      'ls ../ | tr "\\n" " "; echo; touch ../$(basename "$PWD").done',
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      [
        '==> api <==',
        'api web ',
        '',
        '==> web <==',
        'api api.done web ',
        '',
        'api   ok',
        'web   ok',
        'docs  skipped: missing',
        '',
        '2 ok, 1 skipped',
        '',
      ].join('\n'),
    );
  });

  test("the command's stderr goes to stderr", () => {
    const { dir } = clonedApi();

    const result = execIn(dir, '--', 'echo oops >&2');

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('oops\n');
  });

  test('keeps going after a failure, and exits 1 with the exit code', () => {
    const dir = threeListed();

    const result = execIn(
      dir,
      '--',
      '[ "$(basename "$PWD")" = web ] || exit 3',
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toBe(
      [
        '==> api <==',
        '',
        '==> web <==',
        '',
        'api   failed: exit code 3',
        'web   ok',
        'docs  skipped: missing',
        '',
        '1 ok, 1 failed, 1 skipped',
        '',
      ].join('\n'),
    );
  });

  test('a command killed by a signal fails, naming the signal', () => {
    const { dir } = clonedApi();

    const result = execIn(dir, '--', 'kill -TERM $$');

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('api  failed: killed by SIGTERM\n');
  });

  test('a listed folder that is not a git repository fails without running', () => {
    const dir = workspace({ api: { url: remote() } });
    mkdirSync(join(dir, 'projects', 'api'), { recursive: true });

    const result = execIn(dir, '--', 'echo ran');

    expect(result.code).toBe(1);
    expect(result.stdout).toBe(
      'api  failed: not a git repository\n\n1 failed\n',
    );
  });

  test('with nothing cloned, every Project is skipped and it exits 0', () => {
    const dir = workspace({ api: { url: remote() } });

    const result = execIn(dir, '--', 'echo ran');

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('api  skipped: missing\n\n1 skipped\n');
  });

  test('takes a Selection before --', () => {
    const dir = threeListed();

    const result = execIn(dir, 'web', '--tag', 'nothing-after', '--', 'true');

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("no Project has the Tag 'nothing-after'");

    const selected = execIn(
      dir,
      '--tag',
      'frontend',
      '--',
      'echo',
      '--tag',
      'x',
    );
    expect(selected.code).toBe(0);
    expect(selected.stdout).toBe('==> web <==\n--tag x\n\nweb  ok\n\n1 ok\n');
  });

  test('the command gets no stdin, so it never waits for input', () => {
    const { dir } = clonedApi();

    const result = execIn(dir, '--', 'cat; echo done');

    expect(result.stdout).toContain('done\n');
  });
});

describe('gitwork exec --parallel', () => {
  test('runs the commands together, with [name] in front of every line', () => {
    const dir = threeListed();

    // Each waits until the other has started, so they must run together.
    const script = [
      'me=$(basename "$PWD")',
      'touch ../$me.started',
      'for i in $(seq 100); do [ $(ls ../*.started | wc -l) -ge 2 ] && break; sleep 0.05; done',
      '[ $(ls ../*.started | wc -l) -ge 2 ] || exit 9',
      'echo "out $me"',
      'echo "err $me" >&2',
      'printf "no newline"',
    ].join('; ');
    const result = execIn(dir, '--parallel', '--', script);

    expect(result.code).toBe(0);
    const [output, results] = result.stdout.split('\n\n');
    expect(output!.split('\n').toSorted()).toEqual([
      '[api] no newline',
      '[api] out api',
      '[web] no newline',
      '[web] out web',
    ]);
    expect(results).toBe('api   ok\nweb   ok\ndocs  skipped: missing');
    expect(result.stderr.split('\n').filter(Boolean).toSorted()).toEqual([
      '[api] err api',
      '[web] err web',
    ]);
  });
});

describe('gitwork exec: command line', () => {
  test('needs a command after --', () => {
    const { dir } = clonedApi();

    for (const args of [[], ['api'], ['--'], ['--', ' ']]) {
      const result = execIn(dir, ...args);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("'exec' needs a command after '--'");
    }
  });

  test('other commands refuse -- and --parallel', () => {
    const { dir } = clonedApi();

    const dashes = gitwork(['status', '--', 'ls'], { cwd: dir });
    expect(dashes.code).toBe(1);
    expect(dashes.stderr).toContain("'status' takes nothing after '--'");

    const parallel = gitwork(['sync', '--parallel'], { cwd: dir });
    expect(parallel.code).toBe(1);
    expect(parallel.stderr).toContain("'sync' does not support --parallel");
  });

  test('refuses --json', () => {
    const { dir } = clonedApi();

    const result = execIn(dir, '--json', '--', 'true');

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("'exec' does not support --json");
  });
});
