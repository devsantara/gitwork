import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { errorCode, UserError } from "../errors.js";

const MANIFEST = "gitwork.yaml";
const PROJECTS_ENTRY = "/projects/";

/** Writes an empty Manifest in `dir` and makes git ignore its `projects/` folder. */
export function init(dir: string): number {
  const manifest = join(dir, MANIFEST);
  try {
    // "wx" fails if the file exists, so an existing Manifest is never overwritten.
    writeFileSync(manifest, "version: 1\nprojects: {}\n", { flag: "wx" });
  } catch (error) {
    if (errorCode(error) === "EEXIST") throw new UserError(`${MANIFEST} already exists in ${dir}`);
    throw error;
  }

  let added: boolean;
  try {
    added = addToGitignore(join(dir, ".gitignore"), PROJECTS_ENTRY);
  } catch (error) {
    // Undo the Manifest so that running init again can finish the job.
    rmSync(manifest);
    throw new UserError(`could not update .gitignore: ${(error as Error).message}`);
  }

  console.log(`Created ${MANIFEST}`);
  if (added) console.log(`Added ${PROJECTS_ENTRY} to .gitignore`);
  return 0;
}

/** Appends `entry` as a line of the file, creating it if needed. Returns false if already present. */
function addToGitignore(file: string, entry: string): boolean {
  let content = "";
  try {
    content = readFileSync(file, "utf8");
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  if (content.split(/\r?\n/).some((line) => line.trim() === entry)) return false;

  const separator = content === "" || content.endsWith("\n") ? "" : "\n";
  writeFileSync(file, `${content}${separator}${entry}\n`);
  return true;
}
