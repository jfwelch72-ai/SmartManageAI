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
      // Task #2947 — mobile outbox test relocated from server/__tests__
      // to its correct home next to the code it exercises.
      'mobile/**/*.test.ts',
    ],
    exclude: [
      'node_modules',
      'dist',
      '.cache',
      '**/node_modules/**',
      // Task #1088 — *.serial.test.ts files perform destructive, schema-level
      // mutations (e.g. dropping a column on `users`) and must run in
      // isolation from the parallel suite, otherwise other workers SELECTing
      // from the affected table will fail with `column ... does not exist`.
      // They are excluded from the default `npm test` parallel run and only
      // included when `RUN_SERIAL_DB_TESTS=1` is set, which the dedicated
      // invocation below also sets:
      //   RUN_SERIAL_DB_TESTS=1 npx vitest run \
      //     server/__tests__/<file>.serial.test.ts --no-file-parallelism
      ...(process.env.RUN_SERIAL_DB_TESTS === '1' ? [] : ['**/*.serial.test.ts']),
    ],
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
