import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '../../shared/schema.js': path.resolve(__dirname, '../shared/schema.ts'),
      '../shared/schema.js': path.resolve(__dirname, '../shared/schema.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'dist', 'src/tests'],
    },
  },
});
