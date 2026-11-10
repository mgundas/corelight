import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { buildColliderData, colliderKey } from '../../src/terrain/colliders.js';
import { chunkSizeForLevel } from '../../src/terrain/chunkKey.js';
import { nodeOrigin } from '../../src/terrain/octree.js';

describe('buildColliderData', () => {
  it('builds a non-empty trimesh for a surface chunk', () => {
    // L0 chunk containing the top of the planet: rootMin -512, size 32,
    // surface near local y=400 -> y index floor((400+512)/32) = 28.
    const size = chunkSizeForLevel(0);
    const coord = { x: 16, y: 28, z: 16 };
    const data = buildColliderData(SELA, 1337, coord);
    expect(data.empty).toBe(false);
    expect(data.positions.length).toBeGreaterThan(0);
    expect(data.positions.length % 3).toBe(0);
    expect(data.indices.length).toBeGreaterThan(0);
    // Verts are chunk-relative: inside [0, chunkSize].
    let maxC = 0;
    for (let i = 0; i < data.positions.length; i += 1) {
      const v = data.positions[i] as number;
      if (v > maxC) maxC = v;
      expect(v).toBeGreaterThanOrEqual(-1e-6);
    }
    expect(maxC).toBeLessThanOrEqual(size + 1e-6);
    expect(data.key).toBe(colliderKey(SELA.id, coord));
    const origin = nodeOrigin(SELA, 0, coord);
    expect(data.origin.x).toBeCloseTo(origin.x, 6);
  });

  it('reports empty for a high-altitude chunk', () => {
    // L0 chunk at the root corner: far above the surface, all air.
    const data = buildColliderData(SELA, 1337, { x: 31, y: 31, z: 31 });
    expect(data.empty).toBe(true);
    expect(data.indices.length).toBe(0);
  });

  it('is deterministic for the same seed', () => {
    const a = buildColliderData(SELA, 1337, { x: 2, y: 16, z: -3 });
    const b = buildColliderData(SELA, 1337, { x: 2, y: 16, z: -3 });
    expect(a.empty).toBe(b.empty);
    expect([...a.positions]).toEqual([...b.positions]);
    expect([...a.indices]).toEqual([...b.indices]);
  });
});
