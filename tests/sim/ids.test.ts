import { describe, expect, it } from 'vitest';
import { World } from '../../src/sim/world.js';

describe('World.nextId determinism', () => {
  it('produces identical sequences for identical seeds', () => {
    const a = new World(123);
    const b = new World(123);
    expect([a.nextId('e'), a.nextId('e')]).toEqual([b.nextId('e'), b.nextId('e')]);
  });

  it('differs across seeds', () => {
    const a = new World(1);
    const b = new World(2);
    expect(a.nextId('e')).not.toBe(b.nextId('e'));
  });

  it('debugSpawnMarker IDs are deterministic per seed', () => {
    const mk = (seed: number): string => {
      const w = new World(seed);
      w.dispatch({ type: 'debugSpawnMarker', position: { x: 0, y: 0, z: 0 } });
      w.tick();
      return [...w.entities.keys()][0] ?? '';
    };
    expect(mk(42)).toBe(mk(42));
  });
});
