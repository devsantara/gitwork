import { describe, expect, test } from 'vite-plus/test';

import { UserError } from '#/errors.js';
import type { Manifest, Project } from '#/manifest.js';
import { select } from '#/selection.js';

const project = (name: string, tags: string[] = []): Project => ({
  name,
  url: `git@x:${name}.git`,
  tags,
});

const manifest: Manifest = {
  projects: [
    project('storefront', ['frontend', 'web']),
    project('api', ['backend']),
    project('admin', ['frontend']),
    project('docs'),
  ],
};

const names = (projects: Project[]) => projects.map((p) => p.name);

describe('select', () => {
  test('selects every Project when nothing is named', () => {
    expect(names(select(manifest, { names: [], tags: [] }))).toEqual([
      'storefront',
      'api',
      'admin',
      'docs',
    ]);
  });

  test('selects named Projects', () => {
    expect(names(select(manifest, { names: ['api'], tags: [] }))).toEqual([
      'api',
    ]);
  });

  test('selects every Project carrying a named Tag', () => {
    expect(names(select(manifest, { names: [], tags: ['frontend'] }))).toEqual([
      'storefront',
      'admin',
    ]);
  });

  test('selects every match of any name or Tag, in Manifest order, once each', () => {
    const selection = select(manifest, {
      names: ['docs', 'admin', 'docs'],
      tags: ['backend', 'frontend'],
    });

    expect(names(selection)).toEqual(['storefront', 'api', 'admin', 'docs']);
  });

  test('fails on an unknown name', () => {
    expect(() => select(manifest, { names: ['nope'], tags: [] })).toThrow(
      new UserError("no Project named 'nope' in gitwork.yaml"),
    );
  });

  test('fails on a Tag no Project carries', () => {
    expect(() => select(manifest, { names: [], tags: ['mobile'] })).toThrow(
      new UserError("no Project has the Tag 'mobile'"),
    );
  });

  test('reports every unknown name and Tag at once', () => {
    expect(() =>
      select(manifest, { names: ['api', 'nope'], tags: ['mobile'] }),
    ).toThrow(
      expect.objectContaining({
        message: 'the Selection names 2 unknown Projects or Tags',
        details: [
          "no Project named 'nope' in gitwork.yaml",
          "no Project has the Tag 'mobile'",
        ],
      }),
    );
  });
});
