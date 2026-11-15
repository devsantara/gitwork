import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { errorMessage, UserError } from '#/errors.js';
import { isListed, MANIFEST_FILE } from '#/manifest.js';
import { outcomeLine, outcomeSummary } from '#/outcomes.js';
import { whatCouldBeLost, type ProjectsFolderScan } from '#/projects.js';
import {
  checkProjectsFolder,
  PROJECTS_FOLDER,
  type Workspace,
} from '#/workspace.js';

const OUTCOMES = ['deleted', 'skipped', 'failed'] as const;

interface PruneResult {
  name: string;
  outcome: (typeof OUTCOMES)[number];
  /** Why it was skipped, or what went wrong. */
  details: string[];
}

/**
 * Deletes the Unlisted Projects in `names`, or all of them when no names are
 * given, but only those holding nothing that could be lost (ADR-0002). Any
 * other is Skipped with every reason. Never deletes a listed Project or a
 * folder that isn't a git repository. With `dryRun`, deletes nothing.
 */
export async function prune(
  workspace: Workspace,
  names: readonly string[],
  scan: ProjectsFolderScan,
  options: { dryRun: boolean },
): Promise<number> {
  const targets = names.length > 0 ? [...new Set(names)] : scan.unlisted;
  for (const name of targets) checkPrunable(workspace, name, scan);
  if (targets.length === 0) {
    console.log('no Unlisted Projects to prune');
    return 0;
  }
  checkProjectsFolder(workspace.dir);

  const width = Math.max(...targets.map((name) => name.length));
  const results: PruneResult[] = [];
  for (const name of targets) {
    const result = await pruneProject(
      join(workspace.dir, PROJECTS_FOLDER, name),
      name,
      options.dryRun,
    );
    results.push(result);
    console.log(outcomeLine(name, width, result.outcome, result.details));
  }

  console.log(
    `\n${outcomeSummary(OUTCOMES, results)}` +
      (options.dryRun ? ' (dry run: nothing was deleted)' : ''),
  );
  return results.some((r) => r.outcome === 'failed') ? 1 : 0;
}

/** Fails unless `name` is an Unlisted Project, the only kind prune deletes. */
function checkPrunable(
  workspace: Workspace,
  name: string,
  scan: ProjectsFolderScan,
): void {
  if (isListed(workspace.manifest, name)) {
    throw new UserError(
      `'${name}' is in ${MANIFEST_FILE}, and prune only deletes Unlisted Projects; run 'gitwork remove ${name}' first`,
    );
  }
  if (scan.notRepositories.includes(name)) {
    throw new UserError(
      `${join(PROJECTS_FOLDER, name)} is not a git repository, so prune can't check it and never deletes it`,
    );
  }
  if (!scan.unlisted.includes(name)) {
    throw new UserError(
      `no Unlisted Project named '${name}' in ${PROJECTS_FOLDER}/`,
    );
  }
}

async function pruneProject(
  folder: string,
  name: string,
  dryRun: boolean,
): Promise<PruneResult> {
  try {
    const reasons = await whatCouldBeLost(folder);
    if (reasons.length > 0)
      return { name, outcome: 'skipped', details: reasons };
    if (!dryRun) rmSync(folder, { recursive: true });
    return { name, outcome: 'deleted', details: [] };
  } catch (error) {
    return { name, outcome: 'failed', details: [errorMessage(error)] };
  }
}
