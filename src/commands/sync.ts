import { statSync } from 'node:fs';
import { join } from 'node:path';

import { limitConcurrency } from '#/concurrency.js';
import { errorMessage } from '#/errors.js';
import { git, gitError, isRepositoryRoot } from '#/git.js';
import { MANIFEST_FILE, type Project } from '#/manifest.js';
import { inspectProject, type ProjectState } from '#/projects.js';
import {
  checkProjectsFolder,
  PROJECTS_FOLDER,
  type Workspace,
} from '#/workspace.js';

/** How many Projects sync works on at once. */
const CONCURRENCY = 8;

const OUTCOMES = [
  'cloned',
  'updated',
  'unchanged',
  'skipped',
  'failed',
] as const;

type ProjectResult = {
  name: string;
  /** The states that explain the outcome, as they are once sync is done. */
  states: string[];
} & (
  | { outcome: 'cloned' | 'updated' | 'unchanged' | 'skipped' }
  /** `error` says why, in git's words where git said why. */
  | { outcome: 'failed'; error: string }
);

/**
 * Clones every Missing Project in the Selection and safely updates the cloned
 * ones: it fetches, then only ever fast-forwards. One Project's failure never
 * stops the others.
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
    if (result.states.includes('url mismatch')) {
      console.error(
        `${result.name}: origin is not the url in ${MANIFEST_FILE}; sync still follows the branch's upstream`,
      );
    }
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
  const failed = (error: string): ProjectResult => ({
    name,
    outcome: 'failed',
    states: [],
    error,
  });
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
      if (result.code !== 0) return failed(gitError(result));
      return { name, outcome: 'cloned', states: [] };
    }
    if (!stats.isDirectory() || !(await isRepositoryRoot(folder))) {
      return failed('not a git repository');
    }
    return await updateProject(name, folder, project.url);
  } catch (error) {
    return failed(errorMessage(error));
  }
}

/**
 * Fetches the cloned Project in `folder`, then fast-forwards its checked-out
 * branch when it is simply behind and not Dirty, and its default branch when
 * another branch is checked out. Never merges, rebases, resets or stashes.
 */
async function updateProject(
  name: string,
  folder: string,
  url: string,
): Promise<ProjectResult> {
  const fetched = await git(['fetch', '--all', '--prune', '--quiet'], {
    cwd: folder,
  });
  const failed = (error: string): ProjectResult => ({
    name,
    outcome: 'failed',
    states: [],
    error,
  });
  if (fetched.code !== 0) return failed(gitError(fetched));

  const state = await inspectProject(folder, url);
  let outcome: 'updated' | 'unchanged' | 'skipped' = 'unchanged';
  let states = state.states;
  if (mustSkip(state)) {
    outcome = 'skipped';
  } else if (state.behind !== null && state.behind > 0) {
    // --no-autostash: a user's merge.autoStash must never stash anything.
    const merged = await git(
      ['merge', '--ff-only', '--no-autostash', '--quiet', '@{upstream}'],
      { cwd: folder },
    );
    if (merged.code !== 0) return failed(gitError(merged));
    outcome = 'updated';
    states = states.filter((s) => s !== `behind ${state.behind}`);
  }
  states = states.filter((s) => s !== 'up to date');

  if (await fastForwardDefaultBranch(folder, state))
    states.push(`${state.defaultBranch} updated`);
  return { name, outcome, states };
}

/** Whether updating the checked-out branch could risk someone's work. */
function mustSkip(state: ProjectState): boolean {
  if (state.branch === null || state.operation !== null) return true;
  const { ahead, behind } = state;
  if (ahead === null || behind === null) return false;
  return (ahead > 0 && behind > 0) || (behind > 0 && state.dirty);
}

/**
 * Moves the default branch up to its upstream when another branch is checked
 * out, no other worktree could be using it, and it is simply behind. Only the
 * branch ref changes, never any files, so this is safe even when the Project
 * is Dirty. Returns whether it moved; if git refuses, it is left alone.
 */
async function fastForwardDefaultBranch(
  folder: string,
  state: ProjectState,
): Promise<boolean> {
  const branch = state.defaultBranch;
  // During a merge, rebase and the like, the branch may be the one git will
  // write back when it finishes.
  if (
    branch === null ||
    state.branch === null ||
    branch === state.branch ||
    state.operation !== null
  )
    return false;
  const ref = `refs/heads/${branch}`;

  // A worktree with a detached HEAD may be rebasing or bisecting this branch,
  // and git would write it back when that finishes.
  const worktrees = await git(['worktree', 'list', '--porcelain'], {
    cwd: folder,
  });
  const lines = worktrees.stdout.split('\n');
  if (
    worktrees.code !== 0 ||
    lines.includes(`branch ${ref}`) ||
    lines.includes('detached')
  )
    return false;

  // Empty when there is no such local branch or it has no upstream.
  const upstreamRef = (
    await git(['for-each-ref', '--format=%(upstream)', ref], { cwd: folder })
  ).stdout.trim();
  if (upstreamRef === '') return false;

  const [current, upstream] = await Promise.all(
    [ref, upstreamRef].map(async (name) => {
      const result = await git(
        ['rev-parse', '--verify', '--quiet', '--end-of-options', name],
        { cwd: folder },
      );
      return result.code === 0 ? result.stdout.trim() : undefined;
    }),
  );
  // The upstream ref is gone, such as after a prune.
  if (current === undefined || upstream === undefined) return false;
  if (current === upstream) return false;
  const simplyBehind = await git(
    ['merge-base', '--is-ancestor', current, upstream],
    { cwd: folder },
  );
  if (simplyBehind.code !== 0) return false;

  // Giving the current value makes git refuse if the branch moved meanwhile.
  const updated = await git(
    [
      'update-ref',
      '-m',
      `gitwork sync: fast-forward ${branch} to ${upstreamRef}`,
      ref,
      upstream,
      current,
    ],
    { cwd: folder },
  );
  return updated.code === 0;
}

function formatLine(result: ProjectResult, width: number): string {
  const details = result.outcome === 'failed' ? [result.error] : result.states;
  const outcome =
    details.length > 0
      ? `${result.outcome}: ${details.join(', ')}`
      : result.outcome;
  return `${result.name.padEnd(width)}  ${outcome}`;
}

/** e.g. "2 cloned, 1 updated, 1 failed". */
function summary(results: readonly ProjectResult[]): string {
  const parts = OUTCOMES.flatMap((outcome) => {
    const count = results.filter((r) => r.outcome === outcome).length;
    return count > 0 ? [`${count} ${outcome}`] : [];
  });
  return parts.join(', ');
}
