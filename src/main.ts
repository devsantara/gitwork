import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { init } from "./commands/init.js";
import { errorCode, UserError } from "./errors.js";
import { checkGitVersion } from "./git.js";

const USAGE = `Usage: gitwork [-C <dir>] <command>

Commands:
  init    Create gitwork.yaml here and ignore the projects/ folder

Options:
  -C <dir>       Run as if gitwork was started in <dir>
  -h, --help     Show this help
  -v, --version  Show the gitwork version
`;

/** Runs gitwork with the given arguments and returns the exit code. */
export async function main(args: string[]): Promise<number> {
  try {
    return await run(args);
  } catch (error) {
    if (error instanceof UserError) {
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
  if (values.directory !== undefined) changeDirectory(values.directory);

  await checkGitVersion();

  switch (command) {
    case "init":
      expectNoArguments(command, rest);
      return init(process.cwd());
    default:
      throw new UserError(`unknown command '${command}'. See 'gitwork --help'.`);
  }
}

function parseCommandLine(args: string[]) {
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      options: {
        directory: { type: "string", short: "C" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
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
  if (rest.length > 0) throw new UserError(`'${command}' takes no arguments, got '${rest.join(" ")}'`);
}

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return pkg.version;
}

function isParseArgsError(error: unknown): error is Error {
  return errorCode(error)?.startsWith("ERR_PARSE_ARGS_") ?? false;
}
