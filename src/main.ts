import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { check } from '#/commands/check.js';
import { init } from '#/commands/init.js';
import { sync } from '#/commands/sync.js';
import { errorCode, UserError } from '#/errors.js';
import { checkGitVersion } from '#/git.js';
import { select } from '#/selection.js';
import { loadWorkspace } from '#/workspace.js';

const USAGE = `Usage: gitwork [-C <dir>] <command> [<name>...] [--tag <tag>]...

Commands:
  init           Create gitwork.yaml here and ignore the projects/ folder
  check          Validate gitwork.yaml and report every error
  sync [sel]     Clone Missing Projects

Selection [sel]:
  <name>...      Pick these Projects
  --tag <tag>    Pick every Project with this Tag (repeatable)
                 With no names or Tags, every Project in gitwork.yaml

Options:
  -C <dir>       Run as if gitwork was started in <dir>
      --json     Print the result as JSON (check, sync)
  -h, --help     Show this help
  -v, --version  Show the gitwork version
`;

/** Runs gitwork with the given arguments and returns the exit code. */
export async function main(args: string[]): Promise<number> {
  try {
    return await run(args);
  } catch (error) {
    if (error instanceof UserError) {
      for (const line of error.details) console.error(line);
      console.error(`gitwork: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

async function run(args: string[]): Promise<number> {
  const { values, positionals } = parseCommandLine(args);

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
  if (values.directory !== undefined) changeDirectory(values.directory);

  await checkGitVersion();

  switch (command) {
    case 'init':
      expectNoArguments(command, rest);
      return init(process.cwd());
    case 'check':
      expectNoArguments(command, rest);
      return check(process.cwd(), { json: values.json ?? false });
  }

  // Every other command acts on a Workspace, so none runs while the Manifest
  // is invalid, and none starts work until the whole Selection is known.
  const workspace = loadWorkspace(process.cwd());
  const selection = select(workspace.manifest, { names: rest, tags });
  switch (command) {
    case 'sync':
      return sync(workspace, selection, { json: values.json ?? false });
  }
  throw new Error(`command '${command}' is listed but not implemented`);
}

const COMMANDS = new Set(['init', 'check', 'sync']);
const JSON_COMMANDS = new Set(['check', 'sync']);
const SELECTION_COMMANDS = new Set(['sync']);

function parseCommandLine(args: string[]) {
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      options: {
        directory: { type: 'string', short: 'C' },
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        tag: { type: 'string', multiple: true },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    if (isParseArgsError(error)) throw new UserError(error.message);
    throw error;
  }
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
