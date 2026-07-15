import tsParser from '@typescript-eslint/parser';
import requireReturnReplySend from './eslint-rules/require-return-reply-send.mjs';

/**
 * Deliberately narrow: this config exists to enforce ONE app-wide hazard that no test shape
 * catches (see eslint-rules/require-return-reply-send.mjs). It is not a general style gate, so it
 * turns on no preset — a rule here should earn its place by preventing a bug that ships silently.
 */
export default [
  { ignores: ['dist/**', 'node_modules/**', 'scripts/**', 'dev.mjs'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      // No `project` — the rule is purely syntactic, so it needs no type information. That keeps
      // lint fast and stops it from breaking whenever tsconfig include/exclude shifts.
      parserOptions: {},
    },
    plugins: {
      openldr: { rules: { 'require-return-reply-send': requireReturnReplySend } },
    },
    rules: {
      'openldr/require-return-reply-send': 'error',
    },
  },
];
