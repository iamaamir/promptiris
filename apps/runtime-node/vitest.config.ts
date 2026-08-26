import { createVitestConfig } from '../../tooling/vitest-config.js';
// The stdio entrypoint is process wiring verified by the cross-language integration test.
export default createVitestConfig(85, ['src/index.ts']);
