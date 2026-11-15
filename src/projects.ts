import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { git, gitError, isRepositoryRoot } from '#/git.js';
import { PROJECTS_FOLDER, type Workspace } from '#/workspace.js';

/** How a cloned Project is now, as git sees it. */
export interface ProjectState {
  /** The checked-out branch, or null when HEAD is detached. */
  branch: string | null;
  /** The remote's default branch, or null when it can't be determined. */
  defaultBranch: string | null;
  /** The state words that apply, such as `behind 2` or `dirty`. */
  states: string[];
}

/**
 * Reads the state of the cloned Project in `folder` without touching the
 * network or the folder. With `url`, also reports `url mismatch` when `origin`
 * differs from it. Throws with git's words when git fails.
 */
export async function inspectProject(
  folder: string,
  url?: string,
): Promise<ProjectState> {
  // --no-optional-locks: reading status never rewrites the index.
  const status = await gitOutput(folder, [
    '--no-optional-locks',
    'status',
    '--porcelain=v2',
    '--branch',
  ]);
  const gitDir = (
    await gitOutput(folder, ['rev-parse', '--absolute-git-dir'])
  ).trim();
  const operation = operationInProgress(gitDir);
  const defaultBranch = await remoteDefaultBranch(folder);

  let head = '';
  let upstream: string | undefined;
  let ahead: number | undefined;
  let behind: number | undefined;
  let dirty = false;
  for (const line of status.split('\n')) {
    if (line === '') continue;
    if (line.startsWith('# branch.head ')) head = line.slice(14);
    else if (line.startsWith('# branch.upstream ')) upstream = line.slice(18);
    else if (line.startsWith('# branch.ab ')) {
      const match = /^\+(\d+) -(\d+)$/.exec(line.slice(12));
      ahead = Number(match?.[1] ?? 0);
      behind = Number(match?.[2] ?? 0);
    } else if (!line.startsWith('# ')) dirty = true;
  }

  const detached = head === '(detached)';
  const states: string[] = [];
  // A rebase detaches HEAD on purpose, so `rebasing` alone says it.
  if (detached) {
    if (operation !== 'rebasing' && operation !== 'applying')
      states.push('detached');
  } else if (upstream === undefined) states.push('no upstream');
  // git names the upstream but can't count against it once it's deleted.
  else if (ahead === undefined || behind === undefined) states.push('gone');
  else if (ahead > 0 && behind > 0) states.push('diverged');
  else if (ahead > 0) states.push(`ahead ${ahead}`);
  else if (behind > 0) states.push(`behind ${behind}`);
  else states.push('up to date');
  if (dirty) states.push('dirty');
  if (operation !== undefined) states.push(operation);
  if (url !== undefined && (await originUrl(folder)) !== url)
    states.push('url mismatch');

  return { branch: detached ? null : head, defaultBranch, states };
}

/**
 * What a scan of the Workspace's `projects/` folder found beyond the listed
 * Projects: Unlisted Projects, and folders that aren't git repositories.
 * Names are sorted. Entries starting with `.` can never be Projects and are
 * passed over, as is a `projects` that isn't a real directory.
 */
export interface ProjectsFolderScan {
  unlisted: string[];
  notRepositories: string[];
}

export async function scanProjectsFolder(
  workspace: Workspace,
): Promise<ProjectsFolderScan> {
  const folder = join(workspace.dir, PROJECTS_FOLDER);
  const scan: ProjectsFolderScan = { unlisted: [], notRepositories: [] };
  if (!lstatSync(folder, { throwIfNoEntry: false })?.isDirectory()) return scan;

  const listed = new Set(workspace.manifest.projects.map((p) => p.name));
  const entries = readdirSync(folder, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && !listed.has(entry.name))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const repositories = await Promise.all(
    entries.map(
      async (entry) =>
        entry.isDirectory() &&
        (await isRepositoryRoot(join(folder, entry.name))),
    ),
  );
  entries.forEach((entry, i) =>
    (repositories[i] ? scan.unlisted : scan.notRepositories).push(entry.name),
  );
  return scan;
}

/** The one warning every command but `init` ends with when there are Unlisted Projects. */
export function warnUnlisted(unlisted: readonly string[]): void {
  if (unlisted.length === 0) return;
  console.error(
    `unlisted: ${unlisted.join(', ')} (gitwork prune deletes them; gitwork add <name> lists one)`,
  );
}

async function gitOutput(folder: string, args: string[]): Promise<string> {
  const result = await git(args, { cwd: folder });
  if (result.code !== 0) throw new Error(gitError(result));
  return result.stdout;
}

/** The operation git has paused in the middle of, named as a state word. */
function operationInProgress(gitDir: string): string | undefined {
  const has = (name: string) => existsSync(join(gitDir, name));
  if (has('rebase-merge')) return 'rebasing';
  if (has('rebase-apply'))
    return has('rebase-apply/applying') ? 'applying' : 'rebasing';
  if (has('MERGE_HEAD')) return 'merging';
  if (has('CHERRY_PICK_HEAD')) return 'cherry-picking';
  if (has('REVERT_HEAD')) return 'reverting';
  if (has('BISECT_LOG')) return 'bisecting';
  return undefined;
}

/** The branch `origin/HEAD` points at, as recorded by the clone or the last `git remote set-head`. */
async function remoteDefaultBranch(folder: string): Promise<string | null> {
  const result = await git(
    ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    { cwd: folder },
  );
  if (result.code !== 0) return null;
  return result.stdout.trim().replace(/^origin\//, '');
}

async function originUrl(folder: string): Promise<string | undefined> {
  const result = await git(['config', '--get', 'remote.origin.url'], {
    cwd: folder,
  });
  return result.code === 0 ? result.stdout.trim() : undefined;
}
