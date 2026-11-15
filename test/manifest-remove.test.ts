import { describe, expect, test } from 'vite-plus/test';

import { parseManifest, removeProject } from '#/manifest.js';

const yaml = (...lines: string[]) => `${lines.join('\n')}\n`;

describe('removeProject', () => {
  test('removes a Project, keeping the other comments and formatting', () => {
    const text = removeProject(
      yaml(
        '# Our Workspace',
        'version: 1',
        '',
        'projects:',
        '  # The shop',
        '  storefront:',
        "    url: 'git@github.com:acme/storefront.git' # ssh",
        '    tags: [frontend, web]',
        '',
        '  # The API',
        '  api:',
        '    url: git@github.com:acme/api.git',
        '    tags:',
        '      - backend',
        '    # more to come',
        '',
        '  admin: {url: a}',
        '# end',
      ),
      'api',
    );

    expect(text).toBe(
      yaml(
        '# Our Workspace',
        'version: 1',
        '',
        'projects:',
        '  # The shop',
        '  storefront:',
        "    url: 'git@github.com:acme/storefront.git' # ssh",
        '    tags: [frontend, web]',
        '',
        '  admin: {url: a}',
        '# end',
      ),
    );
  });

  test('removes an entry with a comment at the start of a line inside it', () => {
    const text = removeProject(
      yaml(
        'version: 1',
        'projects:',
        '  api:',
        '    url: a',
        '# about the description',
        '    description: d',
        '  web:',
        '    url: w',
      ),
      'api',
    );

    expect(text).toBe(yaml('version: 1', 'projects:', '  web:', '    url: w'));
  });

  test('removes the first Project', () => {
    const text = removeProject(
      yaml(
        'version: 1',
        'projects:',
        '  api:',
        '    url: a',
        '  web:',
        '    url: w',
      ),
      'api',
    );

    expect(text).toBe(yaml('version: 1', 'projects:', '  web:', '    url: w'));
  });

  test('removes the last Project with the blank line before it', () => {
    const text = removeProject(
      yaml(
        'version: 1',
        'projects:',
        '  api:',
        '    url: a',
        '',
        '  web:',
        '    url: w',
        '',
        '# end',
      ),
      'web',
    );

    expect(text).toBe(
      yaml('version: 1', 'projects:', '  api:', '    url: a', '', '# end'),
    );
  });

  test('leaves an empty map when the only Project is removed', () => {
    const text = removeProject(
      yaml('version: 1', 'projects: # all of them', '  api:', '    url: a'),
      'api',
    );

    expect(text).toBe(yaml('version: 1', 'projects: {} # all of them'));
    expect(parseManifest(text)).toEqual({
      ok: true,
      manifest: { projects: [] },
    });
  });

  test('removes a Project whose name YAML reads as something else', () => {
    const text = removeProject(
      yaml(
        'version: 1',
        'projects:',
        '  "null":',
        '    url: n',
        '  1.0:',
        '    url: o',
      ),
      '1.0',
    );

    expect(text).toBe(
      yaml('version: 1', 'projects:', '  "null":', '    url: n'),
    );
  });

  test('removes from a projects map written inline', () => {
    const before = yaml(
      'version: 1',
      'projects: {api: {url: a}, web: {url: w, tags: [x]}, admin: {url: d}}  # inline',
    );

    expect(removeProject(before, 'api')).toBe(
      yaml(
        'version: 1',
        'projects: {web: {url: w, tags: [x]}, admin: {url: d}}  # inline',
      ),
    );
    expect(removeProject(before, 'web')).toBe(
      yaml(
        'version: 1',
        'projects: {api: {url: a}, admin: {url: d}}  # inline',
      ),
    );
    expect(removeProject(before, 'admin')).toBe(
      yaml(
        'version: 1',
        'projects: {api: {url: a}, web: {url: w, tags: [x]}}  # inline',
      ),
    );
    expect(
      removeProject(yaml('version: 1', 'projects: {api: {url: a}}'), 'api'),
    ).toBe(yaml('version: 1', 'projects: {}'));
  });

  test('throws for a Project the Manifest does not list', () => {
    expect(() =>
      removeProject(yaml('version: 1', 'projects: {}'), 'api'),
    ).toThrow("doesn't list 'api'");
  });
});
