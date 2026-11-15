import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(import.meta.dirname, '../dist/cli.mjs');

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

/** Runs the built `gitwork` command with no stdin, as a script or CI job would. */
export function gitwork(args: string[], { cwd, env }: RunOptions): RunResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: env ?? process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
  });
  if (result.error) throw result.error;
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function tempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'gitwork-test-')));
}

/**
 * Makes a directory holding only a fake `git` that reports `version`, for use as PATH.
 * Each call appends the GIT_TERMINAL_PROMPT it saw and whether stdin was a terminal to `calls.log`.
 */
export function fakeGitPath(version: string): string {
  const dir = tempDir();
  const script = `#!/bin/sh
if [ -t 0 ]; then tty=tty; else tty=notty; fi
echo "$* GIT_TERMINAL_PROMPT=$GIT_TERMINAL_PROMPT $tty" >> "${dir}/calls.log"
echo "git version ${version}"
`;
  writeFileSync(join(dir, 'git'), script, { mode: 0o755 });
  return dir;
}

export const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A bare repository with one commit on `branch`, standing in for a remote. */
export function remote(branch = 'main'): string {
  const work = tempDir();
  git(work, 'init', '-q', '-b', branch);
  writeFileSync(join(work, 'README.md'), `# ${branch}\n`);
  git(work, 'add', '.');
  git(
    work,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-q',
    '-m',
    'first',
  );
  const bare = tempDir();
  git(bare, 'clone', '-q', '--bare', work, '.');
  return bare;
}

export interface Listed {
  url: string;
  tags?: string[];
}

export function workspace(projects: Record<string, Listed>): string {
  const dir = tempDir();
  const lines = ['version: 1', 'projects:'];
  for (const [name, { url, tags }] of Object.entries(projects)) {
    lines.push(`  ${name}:`, `    url: ${url}`);
    if (tags) lines.push(`    tags: [${tags.join(', ')}]`);
  }
  writeFileSync(join(dir, 'gitwork.yaml'), `${lines.join('\n')}\n`);
  return dir;
}
