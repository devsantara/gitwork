import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { gitwork, tempDir } from "./helpers.js";

const read = (dir: string, file: string) => readFileSync(join(dir, file), "utf8");

describe("gitwork init", () => {
  test("writes a Manifest with version 1 and no Projects", () => {
    const dir = tempDir();

    const result = gitwork(["init"], { cwd: dir });

    expect(result.code).toBe(0);
    expect(read(dir, "gitwork.yaml")).toBe("version: 1\nprojects: {}\n");
  });

  test("creates .gitignore ignoring /projects/ when there is none", () => {
    const dir = tempDir();

    gitwork(["init"], { cwd: dir });

    expect(read(dir, ".gitignore")).toBe("/projects/\n");
  });

  test("appends /projects/ to an existing .gitignore", () => {
    const dir = tempDir();
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n");

    gitwork(["init"], { cwd: dir });

    expect(read(dir, ".gitignore")).toBe("node_modules/\n/projects/\n");
  });

  test("starts a new line when .gitignore does not end with one", () => {
    const dir = tempDir();
    writeFileSync(join(dir, ".gitignore"), "node_modules/");

    gitwork(["init"], { cwd: dir });

    expect(read(dir, ".gitignore")).toBe("node_modules/\n/projects/\n");
  });

  test("does not add a duplicate /projects/ entry", () => {
    const dir = tempDir();
    writeFileSync(join(dir, ".gitignore"), "/projects/\nnode_modules/\n");

    const result = gitwork(["init"], { cwd: dir });

    expect(result.code).toBe(0);
    expect(read(dir, ".gitignore")).toBe("/projects/\nnode_modules/\n");
  });

  test("exits 1 and changes nothing when gitwork.yaml already exists", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "gitwork.yaml"), "version: 1\nprojects:\n  api:\n    url: x\n");

    const result = gitwork(["init"], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("gitwork.yaml already exists");
    expect(read(dir, "gitwork.yaml")).toBe("version: 1\nprojects:\n  api:\n    url: x\n");
    expect(existsSync(join(dir, ".gitignore"))).toBe(false);
  });

  test("never runs git init", () => {
    const dir = tempDir();

    gitwork(["init"], { cwd: dir });

    expect(existsSync(join(dir, ".git"))).toBe(false);
  });

  test("tells the user what it did", () => {
    const dir = tempDir();

    const result = gitwork(["init"], { cwd: dir });

    expect(result.stdout).toContain("Created gitwork.yaml");
    expect(result.stdout).toContain("Added /projects/ to .gitignore");
  });

  test("in a git repository, git ignores the projects/ folder afterwards", () => {
    const dir = tempDir();
    execFileSync("git", ["init", "--quiet"], { cwd: dir });
    mkdirSync(join(dir, "projects", "storefront"), { recursive: true });
    writeFileSync(join(dir, "projects", "storefront", "README.md"), "hi\n");

    const result = gitwork(["init"], { cwd: dir });

    expect(result.code).toBe(0);
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(status.split("\n").sort().join("\n").trim()).toBe("?? .gitignore\n?? gitwork.yaml");
  });

  test("exits 1 when given arguments", () => {
    const dir = tempDir();

    const result = gitwork(["init", "extra"], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("takes no arguments");
    expect(existsSync(join(dir, "gitwork.yaml"))).toBe(false);
  });

  test("leaves no Manifest behind when .gitignore cannot be updated", () => {
    const dir = tempDir();
    mkdirSync(join(dir, ".gitignore"));

    const result = gitwork(["init"], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("gitwork: could not update .gitignore");
    expect(existsSync(join(dir, "gitwork.yaml"))).toBe(false);
  });
});
