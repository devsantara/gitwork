import { statSync } from 'node:fs';
import { join } from 'node:path';
import { styleText } from 'node:util';

import { limitConcurrency } from '#/concurrency.js';
import { errorMessage } from '#/errors.js';
import { git, gitError, isRepositoryRoot } from '#/git.js';
import type { Project } from '#/manifest.js';
import { inspectProject } from '#/projects.js';
import {
  checkProjectsFolder,
  PROJECTS_FOLDER,
  type Workspace,
} from '#/workspace.js';

/** How many Projects status works on at once. */
const CONCURRENCY = 8;

interface Row {
  name: string;
  branch: string | null;
  defaultBranch: string | null;
  states: string[];
  /** Set when the Project failed; `error` says why, in git's words where git said why. */
  error?: string;
}

/**
 * Shows one row per Project in the Selection, then one per Unlisted Project
 * in `unlisted`. Offline unless `fetch` is set. Never changes a Project,
 * apart from what `git fetch --prune` does to a listed one's remote branches.
 */
export async function status(
  workspace: Workspace,
  selection: readonly Project[],
  options: {
    json: boolean;
    fetch: boolean;
    unlisted: readonly string[];
    /** Folders in `projects/` that aren't git repositories, outside the Manifest. */
    notRepositories: readonly string[];
  },
): Promise<number> {
  checkProjectsFolder(workspace.dir);
  for (const name of options.notRepositories) {
    console.error(
      `${PROJECTS_FOLDER}/${name} is not a git repository; gitwork leaves it alone`,
    );
  }
  const run = limitConcurrency(CONCURRENCY);
  const folder = (name: string) => join(workspace.dir, PROJECTS_FOLDER, name);
  const rows = await Promise.all([
    ...selection.map((project) =>
      run(() =>
        projectRow(project.name, folder(project.name), options.fetch, project),
      ),
    ),
    // Never fetched: gitwork doesn't act on Unlisted Projects.
    ...options.unlisted.map((name) =>
      run(() => projectRow(name, folder(name), false)),
    ),
  ]);

  if (options.json) {
    console.log(JSON.stringify({ projects: rows }, null, 2));
  } else if (rows.length === 0) {
    console.log('no Projects');
  } else {
    for (const line of formatRows(rows)) console.log(line);
  }
  return rows.some((row) => row.error !== undefined) ? 1 : 0;
}

/** The row of the Project `name` in `folder`; `listed` is its Manifest entry, if any. */
async function projectRow(
  name: string,
  folder: string,
  fetch: boolean,
  listed?: Project,
): Promise<Row> {
  const row: Row = { name, branch: null, defaultBranch: null, states: [] };
  try {
    const stats = statSync(folder, { throwIfNoEntry: false });
    if (stats === undefined) return { ...row, states: ['missing'] };
    if (!stats.isDirectory() || !(await isRepositoryRoot(folder)))
      return { ...row, error: 'not a git repository' };
    if (fetch) {
      const result = await git(['fetch', '--all', '--prune', '--quiet'], {
        cwd: folder,
      });
      if (result.code !== 0) return { ...row, error: gitError(result) };
    }
    const state = await inspectProject(folder, listed?.url);
    return {
      name,
      ...state,
      states: listed ? state.states : ['unlisted', ...state.states],
    };
  } catch (error) {
    return { ...row, error: errorMessage(error) };
  }
}

/** Lines of aligned columns: name, branch (highlighted off the default branch), states. */
function formatRows(rows: readonly Row[]): string[] {
  const nameWidth = Math.max(...rows.map((row) => row.name.length));
  const branchWidth = Math.max(...rows.map((row) => row.branch?.length ?? 0));
  return rows.map((row) => {
    const columns = [row.name.padEnd(nameWidth)];
    if (branchWidth > 0) {
      const branch = (row.branch ?? '').padEnd(branchWidth);
      const offDefault =
        row.branch !== null &&
        row.defaultBranch !== null &&
        row.branch !== row.defaultBranch;
      columns.push(
        offDefault
          ? styleText('yellow', branch, { stream: process.stdout })
          : branch,
      );
    }
    columns.push(
      row.error === undefined ? row.states.join(', ') : `failed: ${row.error}`,
    );
    return columns.join('  ');
  });
}
