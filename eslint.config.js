import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['node_modules/**', 'docs/**', 'coverage/**', 'dist/**', 'data/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Relaxed for existing JS files - tighten as you migrate to TS
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-expressions': 'warn',
      'no-case-declarations': 'warn',
      'no-prototype-builtins': 'warn',
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Strict for new TypeScript files
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/tests/**/*.js', '**/tests/**/*.ts', '**/*.test.js', '**/*.test.ts'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
  prettier
);
