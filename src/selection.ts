import { UserError } from '#/errors.js';
import { MANIFEST_FILE, type Manifest, type Project } from '#/manifest.js';

/** What the user named on the command line to pick Projects. */
export interface SelectionArgs {
  names: readonly string[];
  tags: readonly string[];
}

/**
 * The Selection: every Project named, plus every Project carrying a named Tag,
 * in Manifest order. With nothing named, every listed Project. An unknown name,
 * or a Tag no Project carries, fails before any work starts.
 */
export function select(manifest: Manifest, args: SelectionArgs): Project[] {
  const { projects } = manifest;
  const problems = [
    ...unique(args.names)
      .filter((name) => !projects.some((p) => p.name === name))
      .map((name) => `no Project named '${name}' in ${MANIFEST_FILE}`),
    ...unique(args.tags)
      .filter((tag) => !projects.some((p) => p.tags.includes(tag)))
      .map((tag) => `no Project has the Tag '${tag}'`),
  ];
  if (problems.length === 1) throw new UserError(problems[0]!);
  if (problems.length > 1) {
    throw new UserError(
      `the Selection names ${problems.length} unknown Projects or Tags`,
      problems,
    );
  }

  if (args.names.length === 0 && args.tags.length === 0) return [...projects];
  return projects.filter(
    (p) =>
      args.names.includes(p.name) ||
      p.tags.some((tag) => args.tags.includes(tag)),
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
