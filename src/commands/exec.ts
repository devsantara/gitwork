import { spawn, type StdioOptions } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { Writable } from 'node:stream';

import { limitConcurrency } from '#/concurrency.js';
import { errorCode, errorMessage } from '#/errors.js';
import { isRepositoryRoot } from '#/git.js';
import type { Project } from '#/manifest.js';
import { outcomeLine, outcomeSummary } from '#/outcomes.js';
import {
  checkProjectsFolder,
  PROJECTS_FOLDER,
  type Workspace,
} from '#/workspace.js';

/** How many Projects `exec --parallel` runs the command in at once. */
const CONCURRENCY = 8;

const OUTCOMES = ['ok', 'failed', 'skipped'] as const;

type ProjectResult = { name: string } & (
  | { outcome: 'ok' }
  | { outcome: 'skipped'; states: string[] }
  /** `error` says why, such as `exit code 2`. */
  | { outcome: 'failed'; error: string }
);

/** Where a command's output goes: inherited by the child, or line by line through gitwork. */
type Output = 'inherit' | { prefix: string };

/**
 * Runs `command` in every cloned Project of the Selection (see `runCommand`),
 * one at a time with a heading above each Project's output, or with
 * `parallel` up to 8 at once with the Project's name in front of every line.
 * Keeps going after a failure, then prints one line per Project and a summary.
 */
export async function exec(
  workspace: Workspace,
  selection: readonly Project[],
  command: readonly string[],
  options: { parallel: boolean },
): Promise<number> {
  checkProjectsFolder(workspace.dir);
  const folder = (name: string) => join(workspace.dir, PROJECTS_FOLDER, name);

  // Whether any command has started, and so may have written output.
  let started = false;
  let results: ProjectResult[];
  if (options.parallel) {
    const run = limitConcurrency(CONCURRENCY);
    results = await Promise.all(
      selection.map((project) =>
        run(() =>
          execProject(
            project.name,
            folder(project.name),
            command,
            { prefix: `[${project.name}] ` },
            async () => {
              started = true;
            },
          ),
        ),
      ),
    );
  } else {
    results = [];
    for (const project of selection) {
      const heading = `==> ${project.name} <==\n`;
      const result = await execProject(
        project.name,
        folder(project.name),
        command,
        'inherit',
        async () => {
          await write(process.stdout, started ? `\n${heading}` : heading);
          started = true;
        },
      );
      results.push(result);
    }
  }

  if (results.length === 0) {
    console.log('no Projects to run in');
    return 0;
  }
  const width = Math.max(...results.map((r) => r.name.length));
  // A blank line ends the commands' output.
  if (started) console.log();
  for (const result of results) {
    const details =
      result.outcome === 'failed'
        ? [result.error]
        : result.outcome === 'skipped'
          ? result.states
          : [];
    console.log(outcomeLine(result.name, width, result.outcome, details));
  }
  console.log(`\n${outcomeSummary(OUTCOMES, results)}`);
  return results.some((r) => r.outcome === 'failed') ? 1 : 0;
}

/**
 * Runs `command` in the Project `name` in `folder`, unless it is Missing or
 * not a git repository. `starting` is called just before the command starts.
 */
async function execProject(
  name: string,
  folder: string,
  command: readonly string[],
  output: Output,
  starting: () => Promise<void>,
): Promise<ProjectResult> {
  try {
    const stats = statSync(folder, { throwIfNoEntry: false });
    if (stats === undefined)
      return { name, outcome: 'skipped', states: ['missing'] };
    if (!stats.isDirectory() || !(await isRepositoryRoot(folder)))
      return { name, outcome: 'failed', error: 'not a git repository' };
    await starting();
    const error = await runCommand(command, folder, output);
    return error === undefined
      ? { name, outcome: 'ok' }
      : { name, outcome: 'failed', error };
  } catch (error) {
    return { name, outcome: 'failed', error: errorMessage(error) };
  }
}

/**
 * Runs `command` in `cwd`, with no stdin, so it can never wait for input. A
 * single word is a shell command, run with `sh -c`; several words are a
 * program and its arguments, run as they are, so quotes the user's shell
 * already removed are never parsed again. Returns why it failed, or undefined
 * when it exited 0.
 */
function runCommand(
  command: readonly string[],
  cwd: string,
  output: Output,
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const piped = output !== 'inherit';
    const stream = piped ? 'pipe' : 'inherit';
    const options = {
      cwd,
      // PWD too, so the command starts from the path gitwork gave, not a symlink-free one.
      env: { ...process.env, PWD: cwd, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', stream, stream] satisfies StdioOptions,
    };
    const [file = '', ...args] = command;
    const child =
      args.length === 0
        ? spawn(file, { ...options, shell: true })
        : spawn(file, args, options);
    // Both are set when piped; checked so a missing one can't go unnoticed.
    if (piped) {
      if (child.stdout === null || child.stderr === null) {
        throw new Error('a piped command has no stdout or stderr');
      }
      prefixLines(child.stdout, process.stdout, output.prefix);
      prefixLines(child.stderr, process.stderr, output.prefix);
    }
    child.on('error', (error) => {
      if (errorCode(error) === 'ENOENT') resolve(`command not found: ${file}`);
      else if (errorCode(error) === 'EACCES')
        resolve(`permission denied: ${file}`);
      else reject(error);
    });
    child.on('close', (code, signal) => {
      if (code === 0) resolve(undefined);
      else if (signal !== null) resolve(`killed by ${signal}`);
      else resolve(`exit code ${code}`);
    });
  });
}

/** Copies `from` to `to` with `prefix` in front of every line, including an unfinished last one. */
function prefixLines(
  from: NodeJS.ReadableStream,
  to: Writable,
  prefix: string,
): void {
  let partial = '';
  from.setEncoding('utf8');
  from.on('data', (chunk: string) => {
    const lines = (partial + chunk).split('\n');
    partial = lines.pop()!;
    if (lines.length > 0)
      to.write(lines.map((l) => `${prefix}${l}\n`).join(''));
  });
  from.on('end', () => {
    if (partial !== '') to.write(`${prefix}${partial}\n`);
  });
}

/**
 * Writes `text` and waits until it has been handed to the OS, so that output
 * written next by a child process sharing the stream comes after it.
 */
function write(stream: Writable, text: string): Promise<void> {
  return new Promise((resolve, reject) =>
    stream.write(text, (error) => (error ? reject(error) : resolve())),
  );
}
