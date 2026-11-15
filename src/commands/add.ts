import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { errorMessage, UserError } from '#/errors.js';
import { gitError, isRepositoryRoot } from '#/git.js';
import {
  addProject,
  isValidName,
  MANIFEST_FILE,
  NAME_RULE,
  type Project,
} from '#/manifest.js';
import { cloneProject, originUrl } from '#/projects.js';
import {
  checkEdit,
  checkProjectsFolder,
  PROJECTS_FOLDER,
  readManifestText,
  type Workspace,
} from '#/workspace.js';

export interface AddOptions {
  tags: readonly string[];
  description?: string;
  /** False with --no-clone: list the Project without cloning it. */
  clone: boolean;
}

/**
 * Lists a Project in the Manifest. `add <url> [name]` clones it first and
 * writes the entry only if the clone worked, or adopts `projects/<name>` when
 * that is already a clone of the URL. `add <name>` lists one of the
 * `unlisted` Projects, taking its URL from `origin`. Never commits.
 */
export async function add(
  workspace: Workspace,
  args: readonly string[],
  options: AddOptions,
  unlisted: readonly string[],
): Promise<number> {
  const [target, name, ...extra] = args;
  if (target === undefined) {
    throw new UserError(
      "'add' needs a URL, as in 'gitwork add git@github.com:acme/api.git', or the name of an Unlisted Project",
    );
  }
  if (extra.length > 0) {
    throw new UserError(
      `'add' takes a URL and at most one name, got '${args.join(' ')}'`,
    );
  }
  const tags = [...new Set(options.tags)];
  const badTag = tags.find((tag) => !isValidName(tag));
  if (badTag !== undefined) {
    throw new UserError(`invalid Tag '${badTag}': ${NAME_RULE}`);
  }

  // Git URLs and paths always have a '/' or ':'; Project names never do.
  if (!/[/:]/.test(target)) {
    if (name !== undefined) {
      throw new UserError(
        `'gitwork add ${target}' lists an Unlisted Project and takes no second name; to add a URL, it must contain '/' or ':'`,
      );
    }
    return addUnlisted(workspace, target, tags, options, unlisted);
  }
  return addUrl(workspace, target, name, tags, options);
}

async function addUrl(
  workspace: Workspace,
  url: string,
  explicitName: string | undefined,
  tags: string[],
  options: AddOptions,
): Promise<number> {
  const name = explicitName ?? nameFromUrl(url);
  const giveName = `give one, as in 'gitwork add ${url} <name>'`;
  if (!isValidName(name)) {
    throw new UserError(
      explicitName === undefined
        ? `'${name}', from the URL, can't be a Project name (${NAME_RULE}); ${giveName}`
        : `invalid Project name '${name}': ${NAME_RULE}`,
    );
  }
  const { projects } = workspace.manifest;
  if (projects.some((p) => p.name === name)) {
    throw new UserError(
      `a Project named '${name}' is already in ${MANIFEST_FILE}` +
        (explicitName === undefined ? `; ${giveName}` : ''),
    );
  }
  checkUrlUnused(workspace, url);

  const project = newProject(name, url, tags, options);
  // Worked out before cloning, so that nothing is cloned for an entry that
  // couldn't be written.
  const text = withProject(workspace, project);

  checkProjectsFolder(workspace.dir);
  const path = join(PROJECTS_FOLDER, name);
  const folder = join(workspace.dir, path);
  if (statSync(folder, { throwIfNoEntry: false }) !== undefined) {
    await checkAdoptable(folder, path, url);
    console.log(
      `${path} is already a git repository with origin ${url}; adopting it`,
    );
  } else if (options.clone) {
    const cloned = await cloneProject(workspace.dir, name, url);
    if (cloned.code !== 0) {
      throw new UserError(`could not clone ${url}: ${gitError(cloned)}`);
    }
    console.log(`Cloned ${url} into ${path}`);
  }

  writeManifest(workspace, text, path);
  console.log(`Added ${name} to ${MANIFEST_FILE}`);
  return 0;
}

/** Lists the Unlisted Project `name`, with the URL of its `origin`. */
async function addUnlisted(
  workspace: Workspace,
  name: string,
  tags: string[],
  options: AddOptions,
  unlisted: readonly string[],
): Promise<number> {
  if (workspace.manifest.projects.some((p) => p.name === name)) {
    throw new UserError(`'${name}' is already in ${MANIFEST_FILE}`);
  }
  const path = join(PROJECTS_FOLDER, name);
  if (!unlisted.includes(name)) {
    throw new UserError(
      `no Unlisted Project named '${name}' in ${PROJECTS_FOLDER}/; to add a new Project, give its URL`,
    );
  }
  const url = await originUrl(join(workspace.dir, path));
  if (url === undefined) {
    throw new UserError(
      `${path} has no 'origin' remote to take the URL from; run 'gitwork add <url> ${name}'`,
    );
  }
  checkUrlUnused(workspace, url);

  const project = newProject(name, url, tags, options);
  writeManifest(workspace, withProject(workspace, project), path);
  console.log(`Added ${name} to ${MANIFEST_FILE}, with url ${url}`);
  return 0;
}

function newProject(
  name: string,
  url: string,
  tags: string[],
  options: AddOptions,
): Project {
  const project: Project = { name, url, tags };
  if (options.description !== undefined)
    project.description = options.description;
  return project;
}

/** Fails if a listed Project already has `url`: the Manifest allows each URL once. */
function checkUrlUnused(workspace: Workspace, url: string): void {
  const listed = workspace.manifest.projects.find((p) => p.url === url);
  if (listed !== undefined) {
    throw new UserError(
      `Project '${listed.name}' in ${MANIFEST_FILE} already has the url ${url}`,
    );
  }
}

/**
 * The Project name a URL suggests: its last path segment, without `.git`, as
 * `git clone` would name the folder.
 */
export function nameFromUrl(url: string): string {
  const segment = url.replace(/\/+$/, '').split(/[/:]/).at(-1) ?? '';
  return segment.replace(/\.git$/, '');
}

/** Fails unless the existing `folder` is a git repository whose `origin` is `url`. */
async function checkAdoptable(
  folder: string,
  path: string,
  url: string,
): Promise<void> {
  const exists = `${path} already exists`;
  if (!(await isRepositoryRoot(folder))) {
    throw new UserError(`${exists} and is not a git repository`);
  }
  const origin = await originUrl(folder);
  if (origin === undefined) {
    throw new UserError(`${exists} and has no 'origin' remote`);
  }
  if (origin !== url) {
    throw new UserError(`${exists} and its origin is ${origin}, not ${url}`);
  }
}

/** The Manifest's text with `project` added, checked to still be valid. */
function withProject(workspace: Workspace, project: Project): string {
  return checkEdit(
    addProject(readManifestText(workspace), project),
    `can't add '${project.name}'`,
  );
}

/** Writes the Manifest; if that fails, says that `path` was left Unlisted. */
function writeManifest(workspace: Workspace, text: string, path: string): void {
  try {
    writeFileSync(join(workspace.dir, MANIFEST_FILE), text);
  } catch (error) {
    const left = statSync(join(workspace.dir, path), { throwIfNoEntry: false })
      ? `; ${path} is left Unlisted`
      : '';
    throw new UserError(
      `could not write ${MANIFEST_FILE}: ${errorMessage(error)}${left}`,
    );
  }
}
