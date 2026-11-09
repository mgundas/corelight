// Stable string entity IDs. Never use array indexes as references.
//
// WHY deterministic: same seed + same action stream must produce the same
// world (needed later for saves and co-op snapshots), so sim IDs must not
// depend on wall-clock time or Math.random.

let counter = 0;

/**
 * Unique ID for non-sim (presentational/UI-only) use.
 * Process-deterministic: a bare counter, no Date.now/Math.random, so it
 * never leaks nondeterminism into sim code paths.
 */
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_u${counter.toString(36)}`;
}

/** Deterministic ID generator for tests: seed -> repeatable sequence. */
export function createDeterministicId(prefix: string, seed = 1): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}_test_${seed}_${n}`;
  };
}
