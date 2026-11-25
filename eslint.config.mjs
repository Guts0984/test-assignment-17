import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import boundaries from 'eslint-plugin-boundaries';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/src/shared/api/schema.d.ts', '**/next-env.d.ts', '**/playwright-report/**', '**/test-results/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': 'allow-with-description' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Feature-Sliced Design: a layer imports only from layers below it, never sideways, and only through a slice's index.ts.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { project: 'apps/web/tsconfig.json' } },
      'boundaries/elements': [
        { type: 'app', pattern: 'apps/web/src/app', mode: 'folder' },
        { type: 'pages', pattern: 'apps/web/src/pages/*', mode: 'folder', capture: ['slice'] },
        { type: 'widgets', pattern: 'apps/web/src/widgets/*', mode: 'folder', capture: ['slice'] },
        { type: 'features', pattern: 'apps/web/src/features/*', mode: 'folder', capture: ['slice'] },
        { type: 'entities', pattern: 'apps/web/src/entities/*', mode: 'folder', capture: ['slice'] },
        { type: 'shared', pattern: 'apps/web/src/shared/*', mode: 'folder', capture: ['segment'] },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: 'app', allow: ['app', 'pages', 'widgets', 'features', 'entities', 'shared'] },
            { from: 'pages', allow: [['pages', { slice: '${from.slice}' }], 'widgets', 'features', 'entities', 'shared'] },
            { from: 'widgets', allow: [['widgets', { slice: '${from.slice}' }], 'features', 'entities', 'shared'] },
            { from: 'features', allow: [['features', { slice: '${from.slice}' }], 'entities', 'shared'] },
            { from: 'entities', allow: [['entities', { slice: '${from.slice}' }], 'shared'] },
            { from: 'shared', allow: ['shared'] },
          ],
        },
      ],
      'boundaries/entry-point': [
        'error',
        {
          default: 'disallow',
          rules: [
            { target: ['app', 'pages', 'widgets', 'features', 'entities', 'shared'], allow: 'index.ts' },
          ],
        },
      ],
    },
  },
);
