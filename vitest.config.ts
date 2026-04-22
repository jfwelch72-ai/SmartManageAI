import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'shared/**/*.test.ts',
      'server/**/*.test.ts',
      // Task #1044 — frontend component tests use jsdom via a per-file
      // `// @vitest-environment jsdom` pragma so they coexist with the
      // node-based server suites under one config.
      'client/**/*.test.ts',
      'client/**/*.test.tsx',
    ],
    exclude: ['node_modules', 'dist', '.cache', '**/node_modules/**'],
    globalSetup: ['./server/__tests__/globalSetup.ts'],
    setupFiles: ['./server/__tests__/loadEnvTest.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['server/**/*.ts', 'shared/**/*.ts'],
      exclude: ['**/*.test.ts', 'node_modules', '.cache'],
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './shared'),
      '@': path.resolve(__dirname, './client/src'),
    },
  },
  esbuild: {
    // Task #1044 — match Vite's automatic JSX runtime so client-side .tsx
    // tests (e.g. the notification settings card) don't have to import React.
    jsx: 'automatic',
  },
});
