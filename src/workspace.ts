import { lstatSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { errorMessage, UserError } from '#/errors.js';
import {
  MANIFEST_FILE,
  parseManifest,
  type Manifest,
  type ManifestError,
  type ParseResult,
} from '#/manifest.js';

export interface Workspace {
  dir: string;
  manifest: Manifest;
}

/**
 * The nearest directory at or above `start` holding a Manifest file.
 * Fails when there is none.
 */
export function findWorkspace(start: string): string {
  for (let dir = start; ; dir = dirname(dir)) {
    if (statSync(join(dir, MANIFEST_FILE), { throwIfNoEntry: false })?.isFile())
      return dir;
    if (dirname(dir) === dir) {
      throw new UserError(
        `not in a gitwork workspace (no ${MANIFEST_FILE} here or in any parent directory)`,
      );
    }
  }
}

/** Reads and validates the Manifest of the Workspace in `dir`. */
export function readManifest(dir: string): ParseResult {
  const path = join(dir, MANIFEST_FILE);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new UserError(
      `cannot read ${displayPath(path)}: ${errorMessage(error)}`,
    );
  }
  return parseManifest(text);
}

/**
 * Finds the Workspace from `start` and loads its Manifest. Every command but
 * `init` starts here, so none of them runs while the Manifest is invalid.
 */
export function loadWorkspace(start: string): Workspace {
  const dir = findWorkspace(start);
  const result = readManifest(dir);
  if (!result.ok) throw invalidManifest(dir, result.errors);
  return { dir, manifest: result.manifest };
}

/**
 * Fails unless the Workspace's `projects/` folder is a real directory or
 * doesn't exist yet. A Workspace repository can commit `projects` as a
 * symlink (`/projects/` in .gitignore only matches directories), which would
 * otherwise make gitwork write Projects wherever it points.
 */
export function checkProjectsFolder(dir: string): void {
  const stats = lstatSync(join(dir, PROJECTS_FOLDER), {
    throwIfNoEntry: false,
  });
  if (stats !== undefined && !stats.isDirectory()) {
    throw new UserError(
      `${displayPath(join(dir, PROJECTS_FOLDER))} must be a directory, not ${stats.isSymbolicLink() ? 'a symlink' : 'a file'}`,
    );
  }
}

/** The Manifest's text as it is on disk, comments and all. */
export function readManifestText(workspace: Workspace): string {
  return readFileSync(join(workspace.dir, MANIFEST_FILE), 'utf8');
}

/**
 * `text`, an edited Manifest, once it is checked to still be valid. Otherwise
 * fails, saying `cannot` (e.g. "can't add 'api'") and every error.
 */
export function checkManifestEdit(text: string, cannot: string): string {
  const result = parseManifest(text);
  if (!result.ok) {
    throw new UserError(
      `${cannot}: ${MANIFEST_FILE} would be invalid`,
      result.errors.map(
        (error) => `${MANIFEST_FILE}:${error.line}: ${error.message}`,
      ),
    );
  }
  return text;
}

/** Writes the Manifest's text, failing with a UserError that says why not. */
export function writeManifestText(workspace: Workspace, text: string): void {
  try {
    writeFileSync(join(workspace.dir, MANIFEST_FILE), text);
  } catch (error) {
    throw new UserError(
      `could not write ${MANIFEST_FILE}: ${errorMessage(error)}`,
    );
  }
}

/** The folder in a Workspace that holds its Projects. */
export const PROJECTS_FOLDER = 'projects';

/** The error every command fails with when the Manifest is invalid. */
export function invalidManifest(
  dir: string,
  errors: readonly ManifestError[],
): UserError {
  const path = displayPath(join(dir, MANIFEST_FILE));
  const count = errors.length === 1 ? '1 error' : `${errors.length} errors`;
  return new UserError(
    `${path} has ${count}`,
    errors.map((error) => `${path}:${error.line}: ${error.message}`),
  );
}

/** `path` relative to the current directory, as the user would type it. */
function displayPath(path: string): string {
  return relative(process.cwd(), path);
}
