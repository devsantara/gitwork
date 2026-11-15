import { join } from 'node:path';

import { MANIFEST_FILE } from '#/manifest.js';
import { findWorkspace, invalidManifest, readManifest } from '#/workspace.js';

/** Validates the Manifest offline, reporting every error with its line. */
export function check(cwd: string, options: { json: boolean }): number {
  const dir = findWorkspace(cwd);
  const result = readManifest(dir);
  const errors = result.ok ? [] : result.errors;

  if (options.json) {
    const report = {
      manifest: join(dir, MANIFEST_FILE),
      valid: result.ok,
      errors,
    };
    console.log(JSON.stringify(report, null, 2));
    return result.ok ? 0 : 1;
  }

  if (!result.ok) throw invalidManifest(dir, errors);
  console.log(`${MANIFEST_FILE} is valid`);
  return 0;
}
