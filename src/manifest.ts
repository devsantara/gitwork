import {
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  stringify,
  type Document,
  type Node,
  type YAMLMap,
} from 'yaml';

/** The Manifest's file name, at the top of every Workspace. */
export const MANIFEST_FILE = 'gitwork.yaml';

export interface Project {
  name: string;
  url: string;
  description?: string;
  tags: string[];
}

export interface Manifest {
  /** Listed Projects, in Manifest order. */
  projects: Project[];
}

export interface ManifestError {
  /** 1-based line in the Manifest. */
  line: number;
  message: string;
}

export type ParseResult =
  | { ok: true; manifest: Manifest }
  | { ok: false; errors: ManifestError[] };

/** Project names and Tags: lowercase, and never `..`, `.hidden` or anything else starting with punctuation. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
/** What a valid Project name or Tag looks like, said to the user. */
export const NAME_RULE =
  "use lowercase letters, digits, '.', '_' and '-', starting with a letter or digit";

/** Whether `name` is a valid Project name or Tag. */
export function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

const TOP_LEVEL_KEYS = new Set(['version', 'projects']);
const PROJECT_KEYS = new Set(['url', 'description', 'tags']);

/**
 * Parses and validates a Manifest's text, offline. Collects every error rather
 * than stopping at the first, each with the line it is on.
 */
export function parseManifest(text: string): ParseResult {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, {
    lineCounter,
    // Duplicates are found below, so they can be reported in gitwork's words.
    uniqueKeys: false,
    prettyErrors: false,
  });
  if (doc.errors.length > 0) {
    // Without a well-formed document, further checks would only add noise.
    return {
      ok: false,
      errors: doc.errors.map((error) => ({
        line: lineCounter.linePos(error.pos[0]).line,
        message: `invalid YAML: ${error.message}`,
      })),
    };
  }

  const errors: ManifestError[] = [];
  const lineOf = (node: Node | null): number =>
    node?.range ? lineCounter.linePos(node.range[0]).line : 1;
  const context: Context = {
    doc,
    lineOf,
    report: (node, message) => errors.push({ line: lineOf(node), message }),
  };
  const projects = parseRoot(context);

  if (errors.length > 0) {
    return { ok: false, errors: errors.toSorted((a, b) => a.line - b.line) };
  }
  return { ok: true, manifest: { projects } };
}

interface Context {
  doc: Document;
  lineOf: (node: Node | null) => number;
  /** Records an error on the line where `node` starts (line 1 without a node). */
  report: (node: Node | null, message: string) => void;
}

/** Validates the whole Manifest, returning the Projects it lists. */
function parseRoot(context: Context): Project[] {
  const { doc, report } = context;
  const root = asNode(doc.contents, doc);
  if (!isMap(root)) {
    report(root, "the Manifest must be a map with 'version' and 'projects'");
    return [];
  }

  const top = entries(root, context, '', TOP_LEVEL_KEYS);

  const version = top.get('version');
  if (!version) report(root, "missing required key 'version'");
  else if (!isVersionOne(version.value))
    report(version.key, "'version' must be 1");

  const projectsEntry = top.get('projects');
  if (!projectsEntry) {
    report(root, "missing required key 'projects'");
    return [];
  }
  if (!isMap(projectsEntry.value)) {
    report(projectsEntry.key, "'projects' must be a map keyed by Project name");
    return [];
  }

  const projects: Project[] = [];
  const names = new Set<string>();
  const urls = new Map<string, { name: string; line: number }>();
  for (const pair of projectsEntry.value.items) {
    const key = asNode(pair.key, doc);
    const name = asWritten(key);
    if (name === undefined) {
      report(key, 'Project names must be plain strings');
      continue;
    }
    if (names.has(name)) {
      report(key, `duplicate Project name '${name}'`);
      continue;
    }
    names.add(name);
    if (!NAME_PATTERN.test(name))
      report(key, `invalid Project name '${name}': ${NAME_RULE}`);

    const parsed = parseProject(name, key, asNode(pair.value, doc), context);
    if (!parsed) continue;
    const { project, urlNode } = parsed;

    const first = urls.get(project.url);
    if (first) {
      report(
        urlNode,
        `Project '${name}' has the same url as Project '${first.name}' (line ${first.line})`,
      );
    } else {
      urls.set(project.url, { name, line: context.lineOf(urlNode) });
    }
    projects.push(project);
  }
  return projects;
}

interface Entry {
  /** The key, for errors about the entry as a whole. */
  key: Node | null;
  /** The value, with aliases resolved. */
  value: Node | null;
}

/**
 * Reads a map's entries by key, reporting unknown and duplicate keys.
 * `where` names the map in messages, e.g. " in Project 'api'".
 */
function entries(
  map: YAMLMap,
  { doc, report }: Context,
  where: string,
  allowed: ReadonlySet<string>,
): Map<string, Entry> {
  const result = new Map<string, Entry>();
  for (const pair of map.items) {
    const key = asNode(pair.key, doc);
    const name = asWritten(key);
    if (name === undefined) {
      report(key ?? map, `keys must be plain strings${where}`);
    } else if (!allowed.has(name)) {
      report(key, `unknown key '${name}'${where}`);
    } else if (result.has(name)) {
      report(key, `duplicate key '${name}'${where}`);
    } else {
      result.set(name, { key, value: asNode(pair.value, doc) });
    }
  }
  return result;
}

/**
 * Validates one listed Project. Returns it, with the node holding its url, only
 * when it has a usable url; its other fields may still have had errors.
 */
function parseProject(
  name: string,
  key: Node | null,
  value: Node | null,
  context: Context,
): { project: Project; urlNode: Node | null } | undefined {
  const { doc, report } = context;
  if (!isMap(value)) {
    report(key, `Project '${name}' must be a map with a 'url'`);
    return undefined;
  }

  const where = ` in Project '${name}'`;
  const of = `of Project '${name}'`;
  const fields = entries(value, context, where, PROJECT_KEYS);

  const urlEntry = fields.get('url');
  const url = scalarString(urlEntry?.value ?? null);
  if (!urlEntry) {
    report(key, `Project '${name}' is missing required key 'url'`);
  } else if (!url) {
    report(
      urlEntry.value ?? urlEntry.key,
      `'url' ${of} must be a non-empty string`,
    );
  }

  const project: Project = { name, url: url ?? '', tags: [] };

  const descriptionEntry = fields.get('description');
  if (descriptionEntry) {
    const description = scalarString(descriptionEntry.value);
    if (description === undefined) {
      report(
        descriptionEntry.value ?? descriptionEntry.key,
        `'description' ${of} must be a string`,
      );
    } else {
      project.description = description;
    }
  }

  const tagsEntry = fields.get('tags');
  if (tagsEntry && !isSeq(tagsEntry.value)) {
    report(tagsEntry.value ?? tagsEntry.key, `'tags' ${of} must be a list`);
  } else if (tagsEntry && isSeq(tagsEntry.value)) {
    for (const item of tagsEntry.value.items) {
      const tagNode = asNode(item, doc);
      const tag = asWritten(tagNode);
      if (tag === undefined) report(tagNode, `Tags ${of} must be strings`);
      else if (!NAME_PATTERN.test(tag))
        report(tagNode, `invalid Tag '${tag}'${where}: ${NAME_RULE}`);
      else project.tags.push(tag);
    }
  }

  return url ? { project, urlNode: urlEntry?.value ?? null } : undefined;
}

/**
 * A name (map key or Tag) as the user wrote it, so `1.0` stays "1.0" rather
 * than becoming the number 1. Undefined for nodes that are missing, null or not scalars.
 */
function asWritten(node: Node | null): string | undefined {
  if (!isScalar(node) || node.value === null) return undefined;
  if (node.source !== undefined) return node.source;
  const value = node.value;
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? String(value)
    : undefined;
}

/** A scalar's value when it is a string (quoted or plain), otherwise undefined. */
function scalarString(node: Node | null): string | undefined {
  return isScalar(node) && typeof node.value === 'string'
    ? node.value
    : undefined;
}

/** `value` as a YAML node, following an alias to the node it points to. */
function asNode(value: unknown, doc: Document): Node | null {
  const node = isAlias(value) ? value.resolve(doc) : value;
  return isNode(node) ? node : null;
}

/** True only for `version: 1` as written, not `1.0`, `0x1` or `"1"`. */
function isVersionOne(node: Node | null): boolean {
  return isScalar(node) && node.value === 1 && node.source === '1';
}

/** Whether the Manifest lists a Project named `name`. */
export function isListed(manifest: Manifest, name: string): boolean {
  return manifest.projects.some((p) => p.name === name);
}

/**
 * The Manifest's text with `project` appended to its Projects. Only the new
 * entry is written: everything already there, comments and formatting
 * included, stays exactly as it was. The new entry follows the indentation of
 * the Projects already listed. `text` must be a valid Manifest that doesn't
 * list `project` yet.
 */
export function addProject(text: string, project: Project): string {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: false });
  const projects = doc.get('projects', true);
  if (!isMap(projects)) {
    throw new Error("the Manifest's 'projects' is not a map");
  }
  const column = (node: Node) => lineCounter.linePos(node.range![0]).col - 1;

  const last = projects.items.at(-1);
  if (projects.flow && last !== undefined) {
    // Written inline: the entry goes just before the closing brace.
    const brace = text.lastIndexOf('}', projects.range![1] - 1);
    const comma = text.slice(0, brace).trimEnd().endsWith(',') ? '' : ',';
    return `${text.slice(0, brace)}${comma} ${renderFlowEntry(project)}${text.slice(brace)}`;
  }

  if (last === undefined) {
    // `projects: {}`, as `init` writes it: the map becomes a block.
    const [start, end] = projects.range!;
    const before = text.slice(0, start).replace(/[ \t]+$/, '');
    const rest = text.slice(end);
    const edited = before + rest;
    return insertAfterLine(edited, before.length, renderEntry(project, 2, 2));
  }

  const firstKey = asNode(projects.items[0]!.key, doc)!;
  const firstValue = asNode(projects.items[0]!.value, doc);
  const indent = column(firstKey);
  const firstField =
    isMap(firstValue) && !firstValue.flow
      ? asNode(firstValue.items[0]?.key, doc)
      : null;
  const step = firstField ? column(firstField) - indent : 2;
  const lastValue = asNode(last.value, doc) ?? asNode(last.key, doc)!;
  return insertAfterLine(
    text,
    lastValue.range![1] - 1,
    renderEntry(project, indent, step > 0 ? step : 2),
  );
}

/**
 * The Manifest's text without the Project `name`. Only its entry goes, with
 * the comments on the lines just above it and inside it: everything else,
 * comments and formatting included, stays exactly as it was. Removing the
 * last Project leaves `projects: {}`. `text` must be a valid Manifest that
 * lists `name`.
 */
export function removeProject(text: string, name: string): string {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: false });
  const projects = doc.get('projects', true);
  if (!isMap(projects)) {
    throw new Error("the Manifest's 'projects' is not a map");
  }
  const index = projects.items.findIndex(
    (pair) => asWritten(asNode(pair.key, doc)) === name,
  );
  if (index === -1) throw new Error(`the Manifest doesn't list '${name}'`);
  const keyOf = (i: number) => asNode(projects.items[i]!.key, doc)!;
  const endOf = (i: number) =>
    (asNode(projects.items[i]!.value, doc) ?? keyOf(i)).range![1];

  if (projects.flow) {
    // From this entry to the next one, or from the previous one to this.
    const [start, end] =
      index + 1 < projects.items.length
        ? [keyOf(index).range![0], keyOf(index + 1).range![0]]
        : index > 0
          ? [endOf(index - 1), endOf(index)]
          : [projects.range![0] + 1, projects.range![1] - 1];
    return text.slice(0, start) + text.slice(end);
  }

  const lines = text.split('\n');
  const keyLine = lineCounter.linePos(keyOf(index).range![0]).line - 1;
  const indent = indentOf(lines[keyLine]!);

  // The entry ends at its last line indented deeper than its key. Blank lines
  // and comments at any indentation can sit inside it.
  let end = keyLine + 1;
  for (let i = end; i < lines.length; i++) {
    const line = lines[i]!;
    if (indentOf(line) > indent && !isBlank(line)) end = i + 1;
    else if (!isBlank(line) && !isComment(line)) break;
  }
  let next = end;
  while (next < lines.length && isBlank(lines[next]!)) next++;
  // Comments just above the key, at its indentation, are about this Project.
  let start = keyLine;
  while (
    start > 0 &&
    isComment(lines[start - 1]!) &&
    indentOf(lines[start - 1]!) === indent
  )
    start--;

  if (index + 1 < projects.items.length) {
    // The blank lines after it go too, so the next Project takes its place.
    end = next;
  } else if (index > 0) {
    // The last Project: the blank lines before it go instead.
    while (isBlank(lines[start - 1]!)) start--;
  }
  const kept = [...lines.slice(0, start), ...lines.slice(end)].join('\n');
  if (projects.items.length > 1) return kept;

  // It was the only Project: `projects:` becomes `projects: {}`.
  const pair = isMap(doc.contents)
    ? doc.contents.items.find(
        (item) => asWritten(asNode(item.key, doc)) === 'projects',
      )
    : undefined;
  const colon = text.indexOf(':', asNode(pair?.key, doc)!.range![1]);
  return `${kept.slice(0, colon + 1)} {}${kept.slice(colon + 1)}`;
}

/** How many spaces or tabs `line` starts with. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function isComment(line: string): boolean {
  return line.trimStart().startsWith('#');
}

/** One Project's entry as an inline map entry, like `web: {url: w}`. */
function renderFlowEntry(project: Project): string {
  const fields = stringify(entryFields(project), {
    collectionStyle: 'flow',
    flowCollectionPadding: false,
    lineWidth: 0,
  }).trimEnd();
  return `${oneLine(project.name)}: ${fields}`;
}

/** A listed Project's fields, as written in the Manifest. */
function entryFields(project: Project): Record<string, unknown> {
  return {
    url: project.url,
    ...(project.description !== undefined && {
      description: project.description,
    }),
    ...(project.tags.length > 0 && { tags: project.tags }),
  };
}

/** One Project's entry as block YAML lines, each ending in a newline. */
function renderEntry(project: Project, indent: number, step: number): string {
  const pad = ' '.repeat(indent);
  const fieldPad = ' '.repeat(indent + step);
  const lines = [
    `${pad}${oneLine(project.name)}:`,
    `${fieldPad}url: ${oneLine(project.url)}`,
  ];
  if (project.description !== undefined)
    lines.push(`${fieldPad}description: ${oneLine(project.description)}`);
  if (project.tags.length > 0)
    lines.push(`${fieldPad}tags: [${project.tags.map(oneLine).join(', ')}]`);
  return lines.map((line) => `${line}\n`).join('');
}

/** `text` with `insert` placed after the line holding the character at `offset`. */
function insertAfterLine(text: string, offset: number, insert: string): string {
  const newline = text.indexOf('\n', Math.max(offset, 0));
  if (newline === -1) return `${text}\n${insert}`;
  return text.slice(0, newline + 1) + insert + text.slice(newline + 1);
}

/** A string as a YAML scalar on one line, quoted only when it must be: never a block scalar. */
function oneLine(value: string): string {
  return stringify(value, { lineWidth: 0, blockQuote: false }).trimEnd();
}
