import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';

/**
 * ESLint is the only linter and the only formatter (owner decision, 2026-09-29).
 *
 * Prettier used to do formatting and `eslint-config-prettier` was here to switch
 * its rules off. Both are gone. The reason is that they produced noise rather than
 * help: running `prettier --write` over the markdown reflowed every table in
 * `ROADMAP.md` — 305 changed lines around a one-line edit — and reformatted a test
 * file a change had never touched. A formatter that rewrites files nobody edited
 * costs more to review than the consistency it buys, and it was already failing on
 * 53 files before any of that, so the gate it fed was not a gate.
 *
 * `@stylistic` does the same job inside ESLint, with no second tool, no
 * `.prettierrc`, and no `--ignore-path` to keep in sync. One command, `pnpm lint`,
 * and `pnpm lint:fix` is the formatter.
 *
 * The style is the one `AGENTS.md` Part 10 states: 2-space indent, single quotes,
 * semicolons, trailing commas. It is enforced here rather than described, because a
 * style in a document is a suggestion and a style in a config is a check.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/coverage/**', '**/node_modules/**', 'data/**', 'backups/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { '@stylistic': stylistic },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // The style, in the order AGENTS.md Part 10 lists it.
      '@stylistic/indent': ['error', 2],
      // `allowTemplateLiterals` because a multi-line message has no other
      // spelling. Without it the rule demands single quotes for a string that
      // cannot be written in single quotes, which is a rule that has to be
      // suppressed rather than obeyed.
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: 'always' }],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/arrow-parens': ['error', 'always'],
      '@stylistic/eol-last': ['error', 'always'],
      '@stylistic/no-trailing-spaces': 'error',

      // Correctness rather than layout, but cheap and worth having next to the
      // formatting rules so `lint:fix` is the only command anyone needs.
      '@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0 }],
      '@stylistic/no-mixed-spaces-and-tabs': 'error',
      // The codebase already writes `field: Type;` in an interface, so this asks
      // for what the code does. The first version of this rule asked for no
      // delimiter and produced 170 errors, all of them the existing style being
      // called wrong -- a rule that disagrees with 170 lines of deliberate code
      // is a rule to delete, not a codebase to reformat.
      '@stylistic/member-delimiter-style': ['error', { multiline: { delimiter: 'semi' } }],
      '@stylistic/type-annotation-spacing': 'error',
      '@stylistic/space-before-blocks': 'error',
      '@stylistic/keyword-spacing': 'error',
      '@stylistic/comma-spacing': 'error',
      '@stylistic/key-spacing': 'error',
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly', localStorage: 'readonly' },
    },
  },
  {
    // Build and tooling scripts: plain Node ESM, not application code.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
);
