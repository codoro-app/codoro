import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist', 'coverage', '.vite-template-original'] },

  // Config files themselves aren't part of the app/node tsconfigs, so they
  // can't use type-aware linting.
  {
    files: ['eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // engine/ is a pure-TS library: rating, selection, streak, requeue logic.
  // It must never depend on React or the app/ layer — this is the
  // architectural boundary the whole rating system's testability depends on.
  {
    files: ['src/engine/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'engine/ is pure TS — no React imports.' },
            { name: 'react-dom', message: 'engine/ is pure TS — no React imports.' },
          ],
          patterns: [
            {
              group: ['**/app/*', '**/app', '../app*', '../../app*'],
              message: 'engine/ cannot depend on app/.',
            },
          ],
        },
      ],
    },
  },

  eslintConfigPrettier,
)
