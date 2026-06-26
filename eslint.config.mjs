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

  // JS: server, web (non-Vue), root scripts, tests.
  {
    files: ['server/**/*.js', 'web/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', '*.{js,cjs,mjs}'],
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
