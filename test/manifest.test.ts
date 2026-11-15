import { describe, expect, test } from 'vite-plus/test';

import { parseManifest } from '#/manifest.js';

/** Joins lines into a Manifest's text, so line numbers in tests are easy to read. */
const yaml = (...lines: string[]) => `${lines.join('\n')}\n`;

const errorsOf = (text: string) => {
  const result = parseManifest(text);
  return result.ok ? [] : result.errors;
};

describe('parseManifest', () => {
  test('reads a valid Manifest', () => {
    const result = parseManifest(
      yaml(
        'version: 1',
        'projects:',
        '  storefront:',
        '    url: git@github.com:acme/storefront.git',
        '    description: Customer-facing shop',
        '    tags: [frontend, web]',
        '  api:',
        '    url: git@github.com:acme/api.git',
      ),
    );

    expect(result).toEqual({
      ok: true,
      manifest: {
        projects: [
          {
            name: 'storefront',
            url: 'git@github.com:acme/storefront.git',
            description: 'Customer-facing shop',
            tags: ['frontend', 'web'],
          },
          { name: 'api', url: 'git@github.com:acme/api.git', tags: [] },
        ],
      },
    });
  });

  test('accepts a Manifest with no Projects', () => {
    expect(parseManifest(yaml('version: 1', 'projects: {}'))).toEqual({
      ok: true,
      manifest: { projects: [] },
    });
  });

  test('reports YAML syntax errors with their line', () => {
    expect(
      errorsOf(yaml('version: 1', 'projects:', '  api:', '\turl: x')),
    ).toEqual([
      { line: 4, message: 'invalid YAML: Tabs are not allowed as indentation' },
    ]);
  });

  test('an empty file is an error on line 1', () => {
    expect(errorsOf('')).toEqual([
      {
        line: 1,
        message: "the Manifest must be a map with 'version' and 'projects'",
      },
    ]);
  });

  test('a top level that is not a map is an error', () => {
    expect(errorsOf(yaml('- version: 1'))).toEqual([
      {
        line: 1,
        message: "the Manifest must be a map with 'version' and 'projects'",
      },
    ]);
  });

  describe('version', () => {
    test('is required', () => {
      expect(errorsOf(yaml('projects: {}'))).toEqual([
        { line: 1, message: "missing required key 'version'" },
      ]);
    });

    test.each(['2', '"1"', '1.5', '1.0', '0x1', '[1]'])(
      'must be 1, not %s',
      (value) => {
        expect(errorsOf(yaml('projects: {}', `version: ${value}`))).toEqual([
          { line: 2, message: "'version' must be 1" },
        ]);
      },
    );
  });

  describe('projects', () => {
    test('is required', () => {
      expect(errorsOf(yaml('version: 1'))).toEqual([
        { line: 1, message: "missing required key 'projects'" },
      ]);
    });

    test.each(['[]', 'storefront', ''])('must be a map, not "%s"', (value) => {
      expect(errorsOf(yaml('version: 1', `projects: ${value}`))).toEqual([
        {
          line: 2,
          message: "'projects' must be a map keyed by Project name",
        },
      ]);
    });

    test('each Project must be a map', () => {
      expect(
        errorsOf(yaml('version: 1', 'projects:', '  api: git@x:api.git')),
      ).toEqual([
        { line: 3, message: "Project 'api' must be a map with a 'url'" },
      ]);
    });
  });

  describe('Project names', () => {
    test.each(['api', 'my-api', 'web.v2', 'a_b', '0day', '123'])(
      'accepts %s',
      (name) => {
        expect(
          errorsOf(yaml('version: 1', 'projects:', `  ${name}:`, '    url: x')),
        ).toEqual([]);
      },
    );

    test.each(['..', '.hidden', '-api', '_api', 'API', 'my api', 'a/b', 'é'])(
      'rejects "%s"',
      (name) => {
        expect(
          errorsOf(
            yaml('version: 1', 'projects:', `  "${name}":`, '    url: x'),
          ),
        ).toEqual([
          {
            line: 3,
            message: `invalid Project name '${name}': use lowercase letters, digits, '.', '_' and '-', starting with a letter or digit`,
          },
        ]);
      },
    );

    test('a duplicate name is an error on the second one', () => {
      expect(
        errorsOf(
          yaml(
            'version: 1',
            'projects:',
            '  api:',
            '    url: a',
            '  api:',
            '    url: b',
          ),
        ),
      ).toEqual([{ line: 5, message: "duplicate Project name 'api'" }]);
    });
  });

  describe('Project keys', () => {
    test('url is required', () => {
      expect(
        errorsOf(
          yaml('version: 1', 'projects:', '  api:', '    description: x'),
        ),
      ).toEqual([
        { line: 3, message: "Project 'api' is missing required key 'url'" },
      ]);
    });

    test.each(['""', '42', '[a]', 'null'])(
      'url must be a string, not %s',
      (v) => {
        expect(
          errorsOf(yaml('version: 1', 'projects:', '  api:', `    url: ${v}`)),
        ).toEqual([
          {
            line: 4,
            message: "'url' of Project 'api' must be a non-empty string",
          },
        ]);
      },
    );

    test('description must be a string', () => {
      expect(
        errorsOf(
          yaml(
            'version: 1',
            'projects:',
            '  api:',
            '    url: x',
            '    description: [a]',
          ),
        ),
      ).toEqual([
        { line: 5, message: "'description' of Project 'api' must be a string" },
      ]);
    });

    test('tags must be a list', () => {
      expect(
        errorsOf(
          yaml(
            'version: 1',
            'projects:',
            '  api:',
            '    url: x',
            '    tags: web',
          ),
        ),
      ).toEqual([
        { line: 5, message: "'tags' of Project 'api' must be a list" },
      ]);
    });

    test('Tags that look like numbers are kept as written', () => {
      const result = parseManifest(
        yaml(
          'version: 1',
          'projects:',
          '  api:',
          '    url: x',
          '    tags: [2024, 1.0]',
        ),
      );

      expect(result.ok && result.manifest.projects[0]?.tags).toEqual([
        '2024',
        '1.0',
      ]);
    });

    test('each Tag follows the naming rules', () => {
      expect(
        errorsOf(
          yaml(
            'version: 1',
            'projects:',
            '  api:',
            '    url: x',
            '    tags:',
            '      - backend',
            '      - Web',
            '      - [nested]',
          ),
        ),
      ).toEqual([
        {
          line: 7,
          message:
            "invalid Tag 'Web' in Project 'api': use lowercase letters, digits, '.', '_' and '-', starting with a letter or digit",
        },
        {
          line: 8,
          message: "Tags of Project 'api' must be strings",
        },
      ]);
    });
  });

  describe('unknown and duplicate keys', () => {
    test('an unknown top-level key is an error', () => {
      expect(
        errorsOf(yaml('version: 1', 'projects: {}', 'groups: {}')),
      ).toEqual([{ line: 3, message: "unknown key 'groups'" }]);
    });

    test('an unknown Project key is an error', () => {
      expect(
        errorsOf(
          yaml(
            'version: 1',
            'projects:',
            '  api:',
            '    url: x',
            '    branch: main',
          ),
        ),
      ).toEqual([
        { line: 5, message: "unknown key 'branch' in Project 'api'" },
      ]);
    });

    test('a duplicate top-level key is an error', () => {
      expect(
        errorsOf(yaml('version: 1', 'projects: {}', 'version: 1')),
      ).toEqual([{ line: 3, message: "duplicate key 'version'" }]);
    });

    test('a duplicate Project key is an error', () => {
      expect(
        errorsOf(
          yaml('version: 1', 'projects:', '  api:', '    url: a', '    url: b'),
        ),
      ).toEqual([{ line: 5, message: "duplicate key 'url' in Project 'api'" }]);
    });
  });

  test('two Projects with the same url are an error on the second', () => {
    expect(
      errorsOf(
        yaml(
          'version: 1',
          'projects:',
          '  api:',
          '    url: git@x:api.git',
          '  api2:',
          '    url: git@x:api.git',
        ),
      ),
    ).toEqual([
      {
        line: 6,
        message: "Project 'api2' has the same url as Project 'api' (line 4)",
      },
    ]);
  });

  test('urls are compared as exact strings', () => {
    expect(
      errorsOf(
        yaml(
          'version: 1',
          'projects:',
          '  api:',
          '    url: git@x:api.git',
          '  api2:',
          '    url: git@x:api',
        ),
      ),
    ).toEqual([]);
  });

  test('reports every error at once, in line order', () => {
    expect(
      errorsOf(
        yaml(
          'version: 2',
          'projects:',
          '  Api:',
          '    url: x',
          '    colour: red',
          '  web: {}',
          'extra: true',
        ),
      ).map((error) => error.line),
    ).toEqual([1, 3, 5, 6, 7]);
  });
});
