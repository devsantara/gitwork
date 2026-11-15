import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { check } from '#/commands/check.js';
import { exec } from '#/commands/exec.js';
import { init } from '#/commands/init.js';
import { status } from '#/commands/status.js';
import { sync } from '#/commands/sync.js';
import { errorCode, UserError } from '#/errors.js';
import { checkGitVersion } from '#/git.js';
import { scanProjectsFolder, warnUnlisted } from '#/projects.js';
import { select } from '#/selection.js';
import { loadWorkspace } from '#/workspace.js';

const USAGE = `Usage: gitwork [-C <dir>] <command> [<name>...] [--tag <tag>]...

Commands:
  init           Create gitwork.yaml here and ignore the projects/ folder
  check          Validate gitwork.yaml and report every error
  sync [sel]     Clone Missing Projects and fast-forward cloned ones
  status [sel]   Show the branch and states of each Project
  exec [sel] -- <command>
                 Run <command> through the shell in each cloned Project

Selection [sel]:
  <name>...      Pick these Projects
  --tag <tag>    Pick every Project with this Tag (repeatable)
                 With no names or Tags, every Project in gitwork.yaml

Options:
  -C <dir>       Run as if gitwork was started in <dir>
      --json     Print the result as JSON (check, sync, status)
      --fetch    Fetch every remote of each Project first (status)
      --parallel
                 Run in up to 8 Projects at once, naming each line (exec)
  -h, --help     Show this help
  -v, --version  Show the gitwork version
`;

/** Runs gitwork with the given arguments and returns the exit code. */
export async function main(args: string[]): Promise<number> {
  // Filled in once the Workspace is scanned, so that the warning about
  // Unlisted Projects ends the output even when the command then fails.
  const unlisted: string[] = [];
  try {
    return await run(args, unlisted);
  } catch (error) {
    if (error instanceof UserError) {
      for (const line of error.details) console.error(line);
      console.error(`gitwork: ${error.message}`);
      return 1;
    }
    throw error;
  } finally {
    warnUnlisted(unlisted);
  }
}

async function run(args: string[], unlisted: string[]): Promise<number> {
  const { values, positionals, commandArgs } = parseCommandLine(args);

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (values.version) {
    console.log(packageVersion());
    return 0;
  }

  const [command, ...rest] = positionals;
  if (command === undefined) {
    process.stderr.write(USAGE);
    return 1;
  }
  if (!COMMANDS.has(command)) {
    throw new UserError(`unknown command '${command}'. See 'gitwork --help'.`);
  }
  if (values.json && !JSON_COMMANDS.has(command)) {
    throw new UserError(`'${command}' does not support --json`);
  }
  const tags = values.tag ?? [];
  if (tags.length > 0 && !SELECTION_COMMANDS.has(command)) {
    throw new UserError(`'${command}' does not support --tag`);
  }
  if (values.fetch && command !== 'status') {
    throw new UserError(`'${command}' does not support --fetch`);
  }
  if (values.parallel && command !== 'exec') {
    throw new UserError(`'${command}' does not support --parallel`);
  }
  if (command !== 'exec' && commandArgs !== undefined) {
    throw new UserError(`'${command}' takes nothing after '--'`);
  }
  // Joined like ssh joins its arguments: the shell parses the result.
  const shellCommand = commandArgs?.join(' ') ?? '';
  if (command === 'exec' && shellCommand.trim() === '') {
    throw new UserError(
      "'exec' needs a command after '--', as in 'gitwork exec -- npm test'",
    );
  }
  if (values.directory !== undefined) changeDirectory(values.directory);

  await checkGitVersion();

  switch (command) {
    case 'init':
      expectNoArguments(command, rest);
      return init(process.cwd());
    case 'check': {
      expectNoArguments(command, rest);
      const code = check(process.cwd(), { json: values.json ?? false });
      // Unlisted Projects can only be told apart once the Manifest is valid.
      if (code === 0) {
        const workspace = loadWorkspace(process.cwd());
        unlisted.push(...(await scanProjectsFolder(workspace)).unlisted);
      }
      return code;
    }
  }

  // Every other command acts on a Workspace, so none runs while the Manifest
  // is invalid, and none starts work until the whole Selection is known.
  const workspace = loadWorkspace(process.cwd());
  const scan = await scanProjectsFolder(workspace);
  unlisted.push(...scan.unlisted);
  const selection = select(
    workspace.manifest,
    { names: rest, tags },
    scan.unlisted,
  );
  const json = values.json ?? false;
  switch (command) {
    case 'sync':
      return sync(workspace, selection, { json });
    case 'status':
      return status(workspace, selection, {
        json,
        fetch: values.fetch ?? false,
        // Unlisted Projects get rows only when nothing narrows the Selection.
        unlisted: rest.length === 0 && tags.length === 0 ? scan.unlisted : [],
        notRepositories: scan.notRepositories,
      });
    case 'exec':
      return exec(workspace, selection, shellCommand, {
        parallel: values.parallel ?? false,
      });
  }
  throw new Error(`command '${command}' is listed but not implemented`);
}

const COMMANDS = new Set(['init', 'check', 'sync', 'status', 'exec']);
const JSON_COMMANDS = new Set(['check', 'sync', 'status']);
const SELECTION_COMMANDS = new Set(['sync', 'status', 'exec']);

/**
 * The options and positionals before `--`, and the arguments after it, or
 * undefined when there is no `--`.
 */
function parseCommandLine(args: string[]) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      tokens: true,
      options: {
        directory: { type: 'string', short: 'C' },
        fetch: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        parallel: { type: 'boolean' },
        tag: { type: 'string', multiple: true },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    if (isParseArgsError(error)) throw new UserError(error.message);
    throw error;
  }
  const terminator = parsed.tokens.find(
    (token) => token.kind === 'option-terminator',
  );
  if (terminator === undefined) {
    return { ...parsed, commandArgs: undefined };
  }
  return {
    ...parsed,
    positionals: parsed.tokens.flatMap((token) =>
      token.kind === 'positional' && token.index < terminator.index
        ? [token.value]
        : [],
    ),
    commandArgs: args.slice(terminator.index + 1),
  };
}

function changeDirectory(dir: string): void {
  const target = resolve(dir);
  if (!statSync(target, { throwIfNoEntry: false })?.isDirectory()) {
    throw new UserError(`cannot change to '${dir}': no such directory`);
  }
  process.chdir(target);
}

function expectNoArguments(command: string, rest: string[]): void {
  if (rest.length > 0) {
    throw new UserError(
      `'${command}' takes no arguments, got '${rest.join(' ')}'`,
    );
  }
}

function packageVersion(): string {
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  return pkg.version;
}

function isParseArgsError(error: unknown): error is Error {
  return errorCode(error)?.startsWith('ERR_PARSE_ARGS_') ?? false;
}
