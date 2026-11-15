import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vite-plus/test';

import { COMMANDS } from '#/main.js';

import { CLI, git, gitwork, remote, tempDir, workspace } from './helpers.js';

describe('gitwork completion', () => {
  test('prints the script for zsh and bash', () => {
    const dir = tempDir();

    const zsh = gitwork(['completion', 'zsh'], { cwd: dir });
    expect(zsh.code).toBe(0);
    expect(zsh.stdout).toMatch(/^#compdef gitwork\n/);

    const bash = gitwork(['completion', 'bash'], { cwd: dir });
    expect(bash.code).toBe(0);
    expect(bash.stdout).toContain('complete -F _gitwork gitwork');
  });

  test('both scripts offer every command', () => {
    const dir = tempDir();
    const zsh = gitwork(['completion', 'zsh'], { cwd: dir }).stdout;
    const bash = gitwork(['completion', 'bash'], { cwd: dir }).stdout;
    const bashCommands = /compgen -W "(init [^"]*)"/
      .exec(bash)?.[1]
      ?.split(' ');

    for (const command of COMMANDS) {
      if (command === '__complete') continue;
      expect(zsh).toContain(`'${command}:`);
      expect(bashCommands).toContain(command);
    }
  });

  test('needs a known shell', () => {
    const dir = tempDir();

    for (const args of [[], ['fish']]) {
      const result = gitwork(['completion', ...args], { cwd: dir });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        "'completion' needs a shell, one of: zsh, bash",
      );
    }
  });
});

describe('gitwork __complete', () => {
  test('lists the listed Projects and the Tags, one per line', () => {
    const dir = workspace({
      api: { url: remote(), tags: ['backend', 'core'] },
      web: { url: remote(), tags: ['core'] },
    });

    expect(gitwork(['__complete', 'projects'], { cwd: dir }).stdout).toBe(
      'api\nweb\n',
    );
    expect(gitwork(['__complete', 'tags'], { cwd: dir }).stdout).toBe(
      'backend\ncore\n',
    );
    expect(
      gitwork(['-C', dir, '__complete', 'tags'], { cwd: tempDir() }).stdout,
    ).toBe('backend\ncore\n');
  });

  test('prints nothing and exits 0 outside a Workspace or for an unknown list', () => {
    const dir = tempDir();

    for (const args of [
      ['__complete', 'projects'],
      ['-C', '/no/such/dir', '__complete', 'tags'],
      ['__complete', 'what'],
    ]) {
      const result = gitwork(args, { cwd: dir });
      expect(result).toEqual({ code: 0, stdout: '', stderr: '' });
    }
  });

  test('lists only Unlisted Projects whose names are valid, never shell syntax', () => {
    const dir = workspace({ api: { url: remote() } });
    for (const name of ['legacy', '$(touch PWNED)', 'Bad Name']) {
      const folder = join(dir, 'projects', name);
      mkdirSync(folder, { recursive: true });
      git(folder, 'init', '-q');
    }

    const result = gitwork(['__complete', 'unlisted'], { cwd: dir });

    expect(result.stdout).toBe('legacy\n');
    expect(existsSync(join(dir, 'PWNED'))).toBe(false);
  });
});

/** A fresh home, with `gitwork` on PATH as the built CLI, as after an install. */
function home(shell: string) {
  const dir = tempDir();
  const bin = tempDir();
  writeFileSync(
    join(bin, 'gitwork'),
    `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    HOME: dir,
    SHELL: `/bin/${shell}`,
    ZDOTDIR: '',
    PATH: `${bin}:${process.env.PATH}`,
  };
  const run = (...args: string[]) => gitwork(args, { cwd: dir, env });
  return { dir, env, run };
}

describe('gitwork completion install', () => {
  const bashRc = process.platform === 'darwin' ? '.bash_profile' : '.bashrc';

  test('adds one block to the rc file of the shell in $SHELL, keeping what was there', () => {
    const { dir, run } = home('zsh');
    writeFileSync(join(dir, '.zshrc'), 'export FOO=1');

    const result = run('completion', 'install');

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      'Added gitwork completion to ~/.zshrc\nOpen a new shell to use it, or run: exec zsh\n',
    );
    const rc = readFileSync(join(dir, '.zshrc'), 'utf8');
    expect(rc).toMatch(/^export FOO=1\n\n# >>> gitwork completion >>>\n/);
    expect(rc).toMatch(
      /compdef _gitwork gitwork\n# <<< gitwork completion <<<\n$/,
    );
  });

  test('running it again changes nothing; an outdated block is replaced', () => {
    const { dir, run } = home('zsh');
    run('completion', 'install');
    const installed = readFileSync(join(dir, '.zshrc'), 'utf8');

    expect(run('completion', 'install').stdout).toBe(
      'gitwork completion is already in ~/.zshrc\n',
    );
    expect(readFileSync(join(dir, '.zshrc'), 'utf8')).toBe(installed);

    writeFileSync(
      join(dir, '.zshrc'),
      `before\n# >>> gitwork completion >>>\nold\n# <<< gitwork completion <<<\nafter\n`,
    );
    expect(run('completion', 'install').stdout).toContain(
      'Updated gitwork completion in ~/.zshrc',
    );
    const rc = readFileSync(join(dir, '.zshrc'), 'utf8');
    expect(rc).toMatch(/^before\n# >>> gitwork completion >>>\n/);
    expect(rc).toMatch(/# <<< gitwork completion <<<\nafter\n$/);
    expect(rc).not.toContain('old');
  });

  test('uninstall takes the block out again', () => {
    const { dir, run } = home('zsh');
    writeFileSync(join(dir, '.zshrc'), 'export FOO=1\n');
    run('completion', 'install');

    expect(run('completion', 'uninstall').stdout).toBe(
      'Removed gitwork completion from ~/.zshrc\n',
    );
    expect(readFileSync(join(dir, '.zshrc'), 'utf8')).toBe('export FOO=1\n');
    expect(run('completion', 'uninstall').stdout).toBe(
      'gitwork completion is not in ~/.zshrc\n',
    );
  });

  test('copies of the block collapse into one; a broken block is left for the user to fix', () => {
    const { dir, run } = home('zsh');
    const rc = join(dir, '.zshrc');
    const old =
      '# >>> gitwork completion >>>\nold\n# <<< gitwork completion <<<\n';
    writeFileSync(rc, `a\n\n${old}b\n\n${old}c\n`);

    expect(run('completion', 'install').stdout).toContain('Updated');
    const once = readFileSync(rc, 'utf8');
    expect(once.match(/# >>> gitwork completion >>>/g)).toHaveLength(1);
    expect(once).toMatch(/^a\n\n# >>> gitwork completion >>>\n[^]*\nb\nc\n$/);

    writeFileSync(rc, `a\n\n${old}b\n${old}c\n`);
    run('completion', 'uninstall');
    expect(readFileSync(rc, 'utf8')).toBe('a\nb\nc\n');

    const broken = 'a\n# >>> gitwork completion >>>\nmine\n';
    writeFileSync(rc, broken);
    for (const action of ['install', 'uninstall']) {
      const result = run('completion', action);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        "~/.zshrc has a '# >>> gitwork completion >>>' line with no partner",
      );
      expect(readFileSync(rc, 'utf8')).toBe(broken);
    }
  });

  test('a named shell wins over $SHELL; an unknown $SHELL must be named', () => {
    const { dir, run } = home('fish');

    const unknown = run('completion', 'install');
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('cannot tell your shell from $SHELL');

    expect(run('completion', 'install', 'bash').code).toBe(0);
    expect(existsSync(join(dir, bashRc))).toBe(true);
    expect(existsSync(join(dir, '.zshrc'))).toBe(false);
  });

  test('bash loads the real completion on the first Tab', () => {
    const { dir, env, run } = home('bash');
    const ws = workspace({ api: { url: remote() }, web: { url: remote() } });
    run('completion', 'install');

    const script = `source ${JSON.stringify(join(dir, bashRc))}
cd ${JSON.stringify(ws)}
COMP_WORDS=(gitwork exec ""); COMP_CWORD=2; COMPREPLY=(); _gitwork
echo "\${COMPREPLY[*]}"`;
    const result = spawnSync('bash', ['-c', script], { env, encoding: 'utf8' });

    expect(result.stdout).toBe('api web\n');
  });

  test('init suggests it until it is installed', () => {
    const { env, run } = home('zsh');
    const hint = "Tab completion: run 'gitwork completion install'";

    expect(run('init').stdout).toContain(hint);
    run('completion', 'install');
    const ws = tempDir();
    expect(gitwork(['init'], { cwd: ws, env }).stdout).not.toContain(hint);
  });
});
