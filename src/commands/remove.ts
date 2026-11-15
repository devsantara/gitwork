import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { errorMessage, UserError } from '#/errors.js';
import { MANIFEST_FILE, removeProject } from '#/manifest.js';
import {
  checkEdit,
  PROJECTS_FOLDER,
  readManifestText,
  type Workspace,
} from '#/workspace.js';

/**
 * Takes the Project `name` out of the Manifest. Its folder is never touched:
 * it becomes Unlisted, for `gitwork prune` to delete (ADR-0002). Never commits.
 */
export function remove(workspace: Workspace, args: readonly string[]): number {
  const [name, ...extra] = args;
  if (name === undefined || extra.length > 0) {
    throw new UserError(
      "'remove' takes one Project name, as in 'gitwork remove api'",
    );
  }
  if (!workspace.manifest.projects.some((p) => p.name === name)) {
    throw new UserError(`no Project named '${name}' in ${MANIFEST_FILE}`);
  }

  const text = checkEdit(
    removeProject(readManifestText(workspace), name),
    `can't remove '${name}'`,
  );
  try {
    writeFileSync(join(workspace.dir, MANIFEST_FILE), text);
  } catch (error) {
    throw new UserError(
      `could not write ${MANIFEST_FILE}: ${errorMessage(error)}`,
    );
  }

  const path = join(PROJECTS_FOLDER, name);
  const cloned =
    statSync(join(workspace.dir, path), { throwIfNoEntry: false }) !==
    undefined;
  console.log(
    `Removed ${name} from ${MANIFEST_FILE}` +
      (cloned
        ? `; ${path} is left as it is, now Unlisted (gitwork prune ${name} deletes it)`
        : ''),
  );
  return 0;
}
