import { defineConfig } from 'vitest/config';

// Cap parallel test workers: the suite has ~100 files and several heavy
// terrain/physics tests; unbounded forks exhaust memory on smaller machines
// (spawn UNKNOWN / V8 OOM). Two workers keeps `npm run check` reliable now
// that M11 added the research/sample suites.
//
// Per-test timeout is 20 s (Vitest's 5 s default is too tight for the real
// collider-building tests when other dev servers share the machine): several
// M13 tests legitimately build dozens of LOD0 collider meshes, and a loaded
// machine can stretch one file past 5 s. Assertions are unchanged.
export default defineConfig({
  test: {
    maxWorkers: 2,
    testTimeout: 20000,
  },
});
