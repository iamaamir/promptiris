export default {
  mutate: ['packages/protocol/src/index.ts', 'packages/core/src/index.ts'],
  plugins: ['@stryker-mutator/vitest-runner', '@stryker-mutator/typescript-checker'],
  testRunner: 'vitest',
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.lint.json',
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'json'],
  jsonReporter: { fileName: '.agent/reports/mutation.json' },
  thresholds: { high: 90, low: 80, break: 75 },
  incremental: true,
  incrementalFile: '.agent/evidence/stryker-incremental.json',
  tempDirName: '.agent/work/stryker',
};
