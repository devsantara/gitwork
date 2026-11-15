import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { fakeGitPath, gitwork, tempDir } from "./helpers.js";

describe("-C <dir>", () => {
  test("runs the command as if started in <dir>", () => {
    const cwd = tempDir();
    const workspace = tempDir();

    const result = gitwork(["-C", workspace, "init"], { cwd });

    expect(result.code).toBe(0);
    expect(existsSync(join(workspace, "gitwork.yaml"))).toBe(true);
    expect(existsSync(join(cwd, "gitwork.yaml"))).toBe(false);
  });

  test("resolves a relative <dir> against the current directory", () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, "team"));

    gitwork(["-C", "team", "init"], { cwd });

    expect(existsSync(join(cwd, "team", "gitwork.yaml"))).toBe(true);
  });

  test("exits 1 when <dir> does not exist", () => {
    const cwd = tempDir();

    const result = gitwork(["-C", "nowhere", "init"], { cwd });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("nowhere");
  });
});

describe("command line", () => {
  test("exits 1 on an unknown command", () => {
    const result = gitwork(["frobnicate"], { cwd: tempDir() });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unknown command 'frobnicate'");
  });

  test("exits 1 on an unknown option", () => {
    const result = gitwork(["--frobnicate", "init"], { cwd: tempDir() });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--frobnicate");
  });

  test("exits 1 with usage when no command is given", () => {
    const result = gitwork([], { cwd: tempDir() });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Usage: gitwork");
  });

  test("--help prints usage and exits 0", () => {
    const result = gitwork(["--help"], { cwd: tempDir() });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: gitwork");
    expect(result.stdout).toContain("init");
  });

  test("--version prints the package version", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8"));

    const result = gitwork(["--version"], { cwd: tempDir() });

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });
});

describe("git check at startup", () => {
  test("exits 1 when git is not installed", () => {
    const dir = tempDir();

    const result = gitwork(["init"], { cwd: dir, env: { PATH: tempDir() } });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("git is not installed");
    expect(existsSync(join(dir, "gitwork.yaml"))).toBe(false);
  });

  test("exits 1 when git is older than 2.34", () => {
    const dir = tempDir();

    const result = gitwork(["init"], { cwd: dir, env: { PATH: fakeGitPath("2.33.8") } });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("git 2.33.8 is too old");
    expect(result.stderr).toContain("2.34");
    expect(existsSync(join(dir, "gitwork.yaml"))).toBe(false);
  });

  test.each(["2.34.0", "2.34.1 (Apple Git-130)", "3.0.0"])("accepts git %s", (version) => {
    const result = gitwork(["init"], { cwd: tempDir(), env: { PATH: fakeGitPath(version) } });

    expect(result.code).toBe(0);
  });

  test("runs git without a terminal and with prompts turned off", () => {
    const path = fakeGitPath("2.40.0");

    gitwork(["init"], { cwd: tempDir(), env: { PATH: path } });

    const calls = readFileSync(join(path, "calls.log"), "utf8").trim().split("\n");
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(/GIT_TERMINAL_PROMPT=0 notty$/);
  });
});
