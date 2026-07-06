// Flat ESLint config (ESLint 9+). Replaces the legacy .eslintrc.json and — unlike
// it — actually lints the web (Vue) and mobile (TypeScript) clients, not just the
// server. Pragmatic: real bugs are errors, unused/style are warnings, and the
// deliberate idioms in this repo (destructure-to-omit, `as any` icon casts) are
// allowed so the signal isn't drowned in noise.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';

const unusedVars = ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }];

export default [
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**',
      '**/.expo/**', 'mobile/android/**', 'mobile/ios/**', 'web/dist/**',
    ],
  },

  // JS: server, web (non-Vue), shared vocabulary, root scripts, tests.
  {
    files: ['server/**/*.js', 'web/**/*.js', 'shared/**/*.js', 'scripts/**/*.{js,mjs}', 'tests/**/*.js', '*.{js,cjs,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': unusedVars,
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['warn', 'smart'],
    },
  },

  // Server request/engine paths log through lib/logger (structured JSON + reqId),
  // never console.* — console is only for the db/ CLI scripts (guardrail #4).
  {
    files: ['server/src/routes/**/*.js', 'server/src/services/**/*.js', 'server/src/lib/**/*.js'],
    rules: {
      'no-console': 'error',
    },
  },

  // Guardrail #2: top-level route files parse, authorize and delegate — all
  // MongoDB access lives behind a services/*Store module (or lib/geo's
  // findWithinRadius). routes/admin is exempt this pass (it reuses shared
  // helpers pending its own store extraction).
  {
    files: ['server/src/routes/*.js'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.name='require'] > Literal[value=/db\\u002Fmongo$/]",
        message: 'Routes must not access MongoDB directly — go through a services/*Store module (CLAUDE.md guardrail #2).',
      }],
    },
  },

  // Vue SFCs (web). `essential` = bug-prevention rules only (no formatting opinions).
  ...pluginVue.configs['flat/essential'].map((c) => ({ ...c, files: ['web/**/*.vue'] })),
  {
    files: ['web/**/*.vue'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'vue/multi-word-component-names': 'off',
      'no-unused-vars': unusedVars,
      eqeqeq: ['warn', 'smart'],
    },
  },

  // Mobile TypeScript (non-type-checked = fast; strict types are covered by `tsc --noEmit`).
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['mobile/**/*.{ts,tsx}', 'tests/**/*.ts'] })),
  {
    files: ['mobile/**/*.{ts,tsx}', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': unusedVars,
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
    },
  },
];
