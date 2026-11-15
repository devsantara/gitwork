// vp migrate: merged .oxlintrc.json (90203e5d735bb983825c3c3d78782a7d).
import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: ['src/cli.ts'],
    format: ['esm'],
    platform: 'node',
  },
  test: {
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 20_000,
  },
  fmt: {
    printWidth: 80,
    tabWidth: 2,
    useTabs: false,
    semi: true,
    singleQuote: true,
    jsxSingleQuote: false,
    trailingComma: 'all',
    endOfLine: 'lf',
    objectWrap: 'preserve',
    bracketSpacing: true,
    bracketSameLine: false,
    singleAttributePerLine: false,
    arrowParens: 'always',
    sortPackageJson: true,
    sortImports: {
      order: 'asc',
      newlinesBetween: true,
      sortSideEffects: true,
      internalPattern: ['#/'],
      groups: [
        ['side_effect'],
        ['builtin'],
        ['external'],
        ['internal'],
        ['parent', 'sibling', 'index'],
        ['style'],
      ],
    },
    ignorePatterns: ['pnpm-lock.yaml'],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    plugins: ['typescript', 'unicorn', 'oxc', 'import', 'node', 'vitest'],
    categories: {
      correctness: 'error',
      suspicious: 'error',
    },
    rules: {
      'typescript/await-thenable': 'error',
      'typescript/no-floating-promises': 'error',
      'typescript/no-misused-promises': 'error',
      'vite-plus/prefer-vite-plus-imports': 'error',
    },
    env: {
      builtin: true,
      node: true,
    },
    jsPlugins: [
      {
        name: 'vite-plus',
        specifier: 'vite-plus/oxlint-plugin',
      },
    ],
  },
});
