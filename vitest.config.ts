import { defineConfig } from 'vitest/config';

// Cap parallel test workers: the suite has ~80 files and several heavy
// terrain/physics tests; unbounded forks exhaust memory on smaller machines
// (spawn UNKNOWN / V8 OOM). Four workers keeps `npm run check` reliable.
export default defineConfig({
  test: {
    maxWorkers: 4,
  },
});
