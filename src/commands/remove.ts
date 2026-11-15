import { statSync } from 'node:fs';
import { join } from 'node:path';

import { UserError } from '#/errors.js';
import { isListed, MANIFEST_FILE, removeProject } from '#/manifest.js';
import {
  checkManifestEdit,
  PROJECTS_FOLDER,
  readManifestText,
  type Workspace,
  writeManifestText,
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
  if (!isListed(workspace.manifest, name)) {
    throw new UserError(`no Project named '${name}' in ${MANIFEST_FILE}`);
  }

  const text = checkManifestEdit(
    removeProject(readManifestText(workspace), name),
    `can't remove '${name}'`,
  );
  writeManifestText(workspace, text);

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
