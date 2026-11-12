import { defineConfig } from 'vitest/config';

// Cap parallel test workers: the suite has ~90 files and several heavy
// terrain/physics tests; unbounded forks exhaust memory on smaller machines
// (spawn UNKNOWN / V8 OOM). Two workers keeps `npm run check` reliable now
// that M11 added the research/sample suites.
export default defineConfig({
  test: {
    maxWorkers: 2,
  },
});
