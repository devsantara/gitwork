import { spawn } from "node:child_process";
import { errorCode, UserError } from "./errors.js";

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
export function git(args: string[], options: { cwd?: string } = {}): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: options.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Fails with a clear message unless git is installed and at least MIN_GIT_VERSION. */
export async function checkGitVersion(): Promise<void> {
  const needed = `gitwork needs git ${MIN_GIT_VERSION.join(".")} or newer`;
  let result: GitResult;
  try {
    result = await git(["--version"]);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw new UserError(`git is not installed or not on PATH; ${needed}`);
    }
    throw error;
  }

  const match = /^git version (\d+)\.(\d+)(\.\d+)?/.exec(result.stdout.trim());
  if (result.code !== 0 || !match) {
    throw new UserError(`could not read the git version from 'git --version'; ${needed}`);
  }
  const [, major, minor, patch = ""] = match;
  const [minMajor, minMinor] = MIN_GIT_VERSION;
  const tooOld = Number(major) < minMajor || (Number(major) === minMajor && Number(minor) < minMinor);
  if (tooOld) {
    throw new UserError(`git ${major}.${minor}${patch} is too old; ${needed}`);
  }
}

