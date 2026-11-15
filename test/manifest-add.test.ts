import { describe, expect, test } from 'vite-plus/test';

import { addProject, parseManifest } from '#/manifest.js';

const yaml = (...lines: string[]) => `${lines.join('\n')}\n`;

describe('addProject', () => {
  test('adds the first Project to the Manifest init writes', () => {
    const text = addProject(yaml('version: 1', 'projects: {}'), {
      name: 'api',
      url: 'git@github.com:acme/api.git',
      tags: [],
    });

    expect(text).toBe(
      yaml(
        'version: 1',
        'projects:',
        '  api:',
        '    url: git@github.com:acme/api.git',
      ),
    );
  });

  test('appends after the last Project, keeping comments and formatting', () => {
    const before = yaml(
      '# Our Workspace',
      'version: 1',
      '',
      'projects:',
      '  # The shop',
      '  storefront:',
      "    url: 'git@github.com:acme/storefront.git' # ssh",
      '    tags: [frontend, web]',
      '',
      '  api:',
      '    url: git@github.com:acme/api.git',
      '    tags:',
      '      - backend',
    );

    const text = addProject(before, {
      name: 'admin',
      url: 'https://github.com/acme/admin.git',
      description: 'Back office: staff only',
      tags: ['frontend', 'internal'],
    });

    expect(text).toBe(
      before +
        yaml(
          '  admin:',
          '    url: https://github.com/acme/admin.git',
          '    description: "Back office: staff only"',
          '    tags: [frontend, internal]',
        ),
    );
  });

  test('keeps a Manifest indented with four spaces', () => {
    const before = yaml(
      'version: 1',
      'projects:',
      '    api:',
      '        url: git@github.com:acme/api.git',
    );

    const text = addProject(before, { name: 'web', url: 'w', tags: [] });

    expect(text).toBe(before + yaml('    web:', '        url: w'));
  });

  test('keeps text after the projects map, such as a trailing comment', () => {
    const text = addProject(
      yaml(
        'projects:',
        '  api:',
        '    url: a',
        '# end of projects',
        'version: 1',
      ),
      { name: 'web', url: 'w', tags: [] },
    );

    expect(parseManifest(text)).toEqual({
      ok: true,
      manifest: {
        projects: [
          { name: 'api', url: 'a', tags: [] },
          { name: 'web', url: 'w', tags: [] },
        ],
      },
    });
    expect(text).toContain('# end of projects');
  });

  test('quotes a name or Tag YAML would read as something else', () => {
    const text = addProject(yaml('version: 1', 'projects: {}'), {
      name: 'null',
      url: 'u',
      tags: ['true', 'web'],
    });

    expect(text).toBe(
      yaml(
        'version: 1',
        'projects:',
        '  "null":',
        '    url: u',
        '    tags: ["true", web]',
      ),
    );
    expect(parseManifest(text)).toEqual({
      ok: true,
      manifest: {
        projects: [{ name: 'null', url: 'u', tags: ['true', 'web'] }],
      },
    });
  });

  test('adds to a projects map written inline, leaving the rest as it was', () => {
    const before = yaml(
      'version: 1',
      'projects: {api: {url: a}}  # inline',
      '',
      '# trailing',
    );

    const text = addProject(before, { name: 'web', url: 'w', tags: ['x'] });

    expect(text).toBe(
      yaml(
        'version: 1',
        'projects: {api: {url: a}, web: {url: w, tags: [x]}}  # inline',
        '',
        '# trailing',
      ),
    );
  });
});
