// ESLint (flat config) for server, client and api. Run: npm run lint
// Recommended rules only; style/formatting is left to .editorconfig.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'loadtest/**', 'e2e/.artifacts/**', 'playwright-report/**', 'test-results/**', 'mobile-audit-report/**', 'uploads/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // TypeScript already reports undefined names (and knows DOM/Node types); this rule only misfires.
      'no-undef': 'off',
      // Logging goes through server/src/lib/logger.ts (redaction); console needs an explicit disable comment.
      'no-console': 'error',
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['server/**/*.ts', 'api/**/*.ts', 'scripts/**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Image generators run code inside a headless browser page (Image, OffscreenCanvas).
    files: ['scripts/generate-*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['client/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    // The two long-standing Rules of Hooks. (v7's React Compiler rules are not enabled: the app does
    // not use the compiler, and they flag working patterns.)
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  {
    // CommonJS helper scripts (E2E visual checks).
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Tests, scripts and E2E print progress on purpose.
    files: ['server/tests/**', 'server/src/scripts/**', 'scripts/**', 'e2e/**'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
);
