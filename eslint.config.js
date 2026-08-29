import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/*.d.ts'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['packages/**/*.ts', 'apps/runtime-node/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.lint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      complexity: ['error', 10],
      'max-depth': ['error', 4],
      'max-lines-per-function': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      'max-lines-per-function': 'off',
    },
  },
  {
    files: ['apps/runtime-node/src/configuration.ts', 'apps/runtime-node/src/server.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['**/*.mjs', 'apps/dashboard/public/*.js'],
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: {
        Buffer: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    files: ['apps/dashboard/public/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        fetch: 'readonly',
        Intl: 'readonly',
        Node: 'readonly',
      },
    },
  },
);
