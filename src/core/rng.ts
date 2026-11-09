// Seeded RNG so world generation is deterministic per seed.

/** Hash a string|number seed into a uint32. */
export function hashSeed(seed: string | number): number {
  if (typeof seed === 'number') {
    return seed >>> 0;
  }
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 generator. Returns floats in [0, 1). */
export function createRng(seed: string | number): () => number {
  let state = hashSeed(seed);
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
