import { statSync } from 'node:fs';
import { join } from 'node:path';

import { limitConcurrency } from '#/concurrency.js';
import { errorMessage } from '#/errors.js';
import { git, gitError, isRepositoryRoot } from '#/git.js';
import type { Project } from '#/manifest.js';
import {
  checkProjectsFolder,
  PROJECTS_FOLDER,
  type Workspace,
} from '#/workspace.js';

/** How many Projects sync works on at once. */
const CONCURRENCY = 8;

const OUTCOMES = ['cloned', 'unchanged', 'failed'] as const;

type ProjectResult =
  | { name: string; outcome: 'cloned' | 'unchanged' }
  /** `error` says why, in git's words where git said why. */
  | { name: string; outcome: 'failed'; error: string };

/**
 * Clones every Missing Project in the Selection. Already-cloned Projects are
 * left as they are for now. One Project's failure never stops the others.
 */
export async function sync(
  workspace: Workspace,
  selection: readonly Project[],
  options: { json: boolean },
): Promise<number> {
  checkProjectsFolder(workspace.dir);
  const run = limitConcurrency(CONCURRENCY);
  const pending = selection.map((project) =>
    run(() => syncProject(workspace.dir, project)),
  );

  const results: ProjectResult[] = [];
  const width = Math.max(0, ...selection.map((p) => p.name.length));
  // Print each result as soon as it and every one before it are done, so the
  // output is in Manifest order but still shows progress.
  for (const promise of pending) {
    const result = await promise;
    results.push(result);
    if (!options.json) console.log(formatLine(result, width));
  }

  if (options.json) {
    console.log(JSON.stringify({ projects: results }, null, 2));
  } else if (results.length === 0) {
    console.log('no Projects to sync');
  } else {
    console.log(`\n${summary(results)}`);
  }
  return results.some((r) => r.outcome === 'failed') ? 1 : 0;
}

async function syncProject(
  workspaceDir: string,
  project: Project,
): Promise<ProjectResult> {
  const { name } = project;
  const folder = join(workspaceDir, PROJECTS_FOLDER, name);
  try {
    const stats = statSync(folder, { throwIfNoEntry: false });
    if (stats === undefined) {
      // A plain clone, except that the remote is always `origin`, whatever
      // the user's clone.defaultRemoteName says.
      const result = await git(
        [
          'clone',
          '--origin',
          'origin',
          '--',
          project.url,
          join(PROJECTS_FOLDER, name),
        ],
        { cwd: workspaceDir },
      );
      if (result.code !== 0)
        return { name, outcome: 'failed', error: gitError(result) };
      return { name, outcome: 'cloned' };
    }
    if (!stats.isDirectory() || !(await isRepositoryRoot(folder))) {
      return { name, outcome: 'failed', error: 'not a git repository' };
    }
    return { name, outcome: 'unchanged' };
  } catch (error) {
    return {
      name,
      outcome: 'failed',
      error: errorMessage(error),
    };
  }
}

function formatLine(result: ProjectResult, width: number): string {
  const outcome =
    result.outcome === 'failed'
      ? `${result.outcome}: ${result.error}`
      : result.outcome;
  return `${result.name.padEnd(width)}  ${outcome}`;
}

/** e.g. "2 cloned, 1 unchanged, 1 failed". */
function summary(results: readonly ProjectResult[]): string {
  const parts = OUTCOMES.flatMap((outcome) => {
    const count = results.filter((r) => r.outcome === outcome).length;
    return count > 0 ? [`${count} ${outcome}`] : [];
  });
  return parts.join(', ');
}
