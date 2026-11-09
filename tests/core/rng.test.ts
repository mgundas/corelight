import { describe, expect, it } from 'vitest';
import { createRng, hashSeed } from '../../src/core/rng.js';

describe('seeded rng', () => {
  it('same seed gives same sequence', () => {
    const a = createRng(123);
    const b = createRng(123);
    for (let i = 0; i < 20; i += 1) {
      expect(a()).toBe(b());
    }
  });

  it('different seeds diverge', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('accepts string seeds and hashes deterministically', () => {
    expect(hashSeed('sela')).toBe(hashSeed('sela'));
    expect(hashSeed('sela')).not.toBe(hashSeed('vorn'));
    const a = createRng('sela');
    const b = createRng('sela');
    expect(a()).toBe(b());
  });

  it('stays in [0, 1)', () => {
    const rng = createRng(999);
    for (let i = 0; i < 100; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
