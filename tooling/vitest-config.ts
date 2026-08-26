import { defineConfig } from 'vitest/config';

export function createVitestConfig(threshold: number, exclude: string[] = []) {
  return defineConfig({
    test: {
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json'],
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts', ...exclude],
        thresholds: {
          branches: threshold,
          functions: threshold,
          lines: threshold,
          statements: threshold,
        },
      },
    },
  });
}
