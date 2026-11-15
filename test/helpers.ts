import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dirname, "../dist/cli.js");

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
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  });
  if (result.error) throw result.error;
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function tempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "gitwork-test-")));
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
  writeFileSync(join(dir, "git"), script, { mode: 0o755 });
  return dir;
}
