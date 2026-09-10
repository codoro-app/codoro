import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'

// Deliberately its own config file, not a block inside the root
// eslint.config.js: typescript-eslint's projectService shares one TS
// Program per ESLint process, and mixing this package's tsconfig.json
// (types: @cloudflare/workers-types, no DOM) into the same run as the
// root's app/node/functions solution took a ~31s lint from ~31s to 5+
// minutes and climbing (measured — see the v5 Phase 5.0 amendment in
// docs/v5-build-plan.md). Two independent global ambient-type universes in
// one Program was the trigger; two independent ESLint processes (root's
// `eslint .` never sees this directory — this package is a separate pnpm
// workspace member, and root's own config lives one level up) is the fix.
export default tseslint.config(
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  eslintConfigPrettier,
)
