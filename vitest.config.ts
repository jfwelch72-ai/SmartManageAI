import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts'],
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
});
