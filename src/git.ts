import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';

import { errorCode, UserError } from '#/errors.js';

/** The oldest git gitwork supports: the one on the oldest Ubuntu LTS in standard support (ADR-0001). */
export const MIN_GIT_VERSION = [2, 34] as const;

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs the user's own git. git never gets a terminal and its own prompts are off,
 * so gitwork never waits for input.
 */
export function git(
  args: string[],
  options: { cwd?: string } = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: options.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout
      .setEncoding('utf8')
      .on('data', (chunk: string) => (stdout += chunk));
    child.stderr
      .setEncoding('utf8')
      .on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Fails with a clear message unless git is installed and at least MIN_GIT_VERSION. */
export async function checkGitVersion(): Promise<void> {
  const needed = `gitwork needs git ${MIN_GIT_VERSION.join('.')} or newer`;
  let result: GitResult;
  try {
    result = await git(['--version']);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new UserError(`git is not installed or not on PATH; ${needed}`);
    }
    throw error;
  }

  const match = /^git version (\d+)\.(\d+)(\.\d+)?/.exec(result.stdout.trim());
  if (result.code !== 0 || !match) {
    throw new UserError(
      `could not read the git version from 'git --version'; ${needed}`,
    );
  }
  const [, major, minor, patch = ''] = match;
  const [minMajor, minMinor] = MIN_GIT_VERSION;
  const tooOld =
    Number(major) < minMajor ||
    (Number(major) === minMajor && Number(minor) < minMinor);
  if (tooOld) {
    throw new UserError(`git ${major}.${minor}${patch} is too old; ${needed}`);
  }
}

/**
 * Whether the directory `folder` is the top of its own git repository. A plain
 * folder inside a Workspace that is itself a git repository would otherwise
 * pass as one.
 */
export async function isRepositoryRoot(folder: string): Promise<boolean> {
  const result = await git(['rev-parse', '--show-toplevel'], { cwd: folder });
  return (
    result.code === 0 &&
    realpathSync(result.stdout.trim()) === realpathSync(folder)
  );
}

/**
 * What git said went wrong: everything up to its first `fatal:` or `error:`
 * line, so that the cause ssh or the server gives just before it (such as
 * "Permission denied (publickey).") is kept, on one line.
 */
export function gitError(result: GitResult): string {
  const lines = result.stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('Cloning into '));
  const fatal = lines.findIndex((line) => /^(fatal|error): /.test(line));
  const said = fatal === -1 ? lines : lines.slice(0, fatal + 1);
  return said.length > 0
    ? said.map((line) => line.replace(/^(fatal|error): /, '')).join(' ')
    : `git exited with code ${result.code}`;
}
