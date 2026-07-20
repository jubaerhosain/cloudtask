import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Shared flat ESLint config for the CloudTask monorepo.
 *
 * Exports three composable arrays:
 *  - `base`: TypeScript + Prettier, used by every package.
 *  - `nest`: base + Node globals, for NestJS apps (api, worker).
 *  - `next`: base + React/Next rules, for the web app.
 */

/** Files ESLint should never look at. */
const ignores = {
  ignores: ['**/dist/**', '**/.next/**', '**/coverage/**', '**/node_modules/**', '**/*.config.*'],
};

/** @type {import('eslint').Linter.Config[]} */
export const base = [
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  prettier,
];

/** @type {import('eslint').Linter.Config[]} */
export const nest = [
  ...base,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // NestJS relies heavily on decorators + DI; these rules fight that pattern.
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
];

/** @type {import('eslint').Linter.Config[]} */
export const next = [
  ...base,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      '@next/next': nextPlugin,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
];

export default base;
