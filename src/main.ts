import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { add } from '#/commands/add.js';
import { check } from '#/commands/check.js';
import {
  complete,
  completion,
  installCompletion,
  uninstallCompletion,
} from '#/commands/completion.js';
import { exec } from '#/commands/exec.js';
import { init } from '#/commands/init.js';
import { prune } from '#/commands/prune.js';
import { remove } from '#/commands/remove.js';
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
  exec [sel] -- <command> [<arg>...]
                 Run a command in each cloned Project: one word runs
                 through the shell, several run as they are
  add <url> [<name>]
                 Clone a Project, then list it in gitwork.yaml
  add <name>     List an Unlisted Project, with its origin as the url
  remove <name>  Take a Project out of gitwork.yaml, leaving its folder
  prune [<name>...]
                 Delete Unlisted Projects that hold nothing that could be lost
  completion install [<shell>]
                 Set up tab completion for zsh or bash (default: $SHELL)
  completion uninstall [<shell>]
                 Take tab completion out again
  completion <shell>
                 Print the completion script, to load it yourself

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
      --description <text>
                 The Project's description (add)
      --no-clone List the Project without cloning it (add)
      --dry-run  Show what would be deleted, deleting nothing (prune)
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
  if (
    tags.length > 0 &&
    !SELECTION_COMMANDS.has(command) &&
    command !== 'add'
  ) {
    throw new UserError(`'${command}' does not support --tag`);
  }
  if (values.fetch && command !== 'status') {
    throw new UserError(`'${command}' does not support --fetch`);
  }
  if (values.parallel && command !== 'exec') {
    throw new UserError(`'${command}' does not support --parallel`);
  }
  if (values.description !== undefined && command !== 'add') {
    throw new UserError(`'${command}' does not support --description`);
  }
  if (values['dry-run'] && command !== 'prune') {
    throw new UserError(`'${command}' does not support --dry-run`);
  }
  if (values['no-clone'] && command !== 'add') {
    throw new UserError(`'${command}' does not support --no-clone`);
  }
  if (command !== 'exec' && commandArgs !== undefined) {
    throw new UserError(`'${command}' takes nothing after '--'`);
  }
  const execCommand = commandArgs ?? [];
  if (command === 'exec' && execCommand.every((word) => word.trim() === '')) {
    throw new UserError(
      "'exec' needs a command after '--', as in 'gitwork exec -- npm test'",
    );
  }
  if (command === 'completion') {
    const [action, ...shells] = rest;
    const install = action === 'install' || action === 'uninstall';
    if ((install ? shells.length : rest.length) > 1) {
      throw new UserError(
        `'completion' takes one shell, got '${(install ? shells : rest).join(' ')}'`,
      );
    }
    if (action === 'install') return installCompletion(shells[0]);
    if (action === 'uninstall') return uninstallCompletion(shells[0]);
    return completion(action);
  }
  if (command === '__complete') {
    // Completing must never fail loudly, not even on a bad -C.
    const dir = values.directory === undefined ? '.' : values.directory;
    return complete(resolve(dir), rest[0]);
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
  if (command === 'add') {
    const code = await add(
      workspace,
      rest,
      {
        tags,
        description: values.description,
        clone: !values['no-clone'],
      },
      scan.unlisted,
    );
    // The Project just listed is Unlisted no more.
    await rescanUnlisted(workspace.dir, unlisted);
    return code;
  }
  if (command === 'prune') {
    const code = await prune(workspace, rest, scan, {
      dryRun: values['dry-run'] ?? false,
    });
    // Only the Projects left behind are still Unlisted.
    await rescanUnlisted(workspace.dir, unlisted);
    return code;
  }
  if (command === 'remove') {
    const code = remove(workspace, rest);
    // Its folder, if it has one, is Unlisted now.
    await rescanUnlisted(workspace.dir, unlisted);
    return code;
  }
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
      return exec(workspace, selection, execCommand, {
        parallel: values.parallel ?? false,
      });
  }
  throw new Error(`command '${command}' is listed but not implemented`);
}

/** Every command; the completion scripts must offer each one but `__complete`. */
export const COMMANDS = new Set([
  'init',
  'check',
  'sync',
  'status',
  'exec',
  'add',
  'remove',
  'prune',
  'completion',
  // Lists Project names and Tags for the completion scripts; not in the usage.
  '__complete',
]);
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
        description: { type: 'string' },
        directory: { type: 'string', short: 'C' },
        'dry-run': { type: 'boolean' },
        fetch: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        'no-clone': { type: 'boolean' },
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

/**
 * Replaces `unlisted` with what a fresh scan finds, for commands that change
 * which Projects are Unlisted. The Manifest is read again, as it may have
 * changed too.
 */
async function rescanUnlisted(dir: string, unlisted: string[]): Promise<void> {
  const after = await scanProjectsFolder(loadWorkspace(dir));
  unlisted.splice(0, unlisted.length, ...after.unlisted);
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
