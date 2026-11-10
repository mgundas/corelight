// Octree tests: split rule, full coverage without overlaps, and the
// cheap empty-node classification used to skip mesh jobs.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import {
  boxesOverlap,
  childrenOf,
  classifyNode,
  createRoot,
  isDefinitelyAir,
  nodeKey,
  nodesAtLevel,
  rootSize,
  updateOctree,
  type OctreeNode,
} from '../../src/terrain/octree.js';
import { createDensityField } from '../../src/terrain/density.js';

function leafContaining(leaves: OctreeNode[], x: number, y: number, z: number): OctreeNode | null {
  for (const leaf of leaves) {
    if (
      x >= leaf.min.x &&
      x < leaf.min.x + leaf.size &&
      y >= leaf.min.y &&
      y < leaf.min.y + leaf.size &&
      z >= leaf.min.z &&
      z < leaf.min.z + leaf.size
    ) {
      return leaf;
    }
  }
  return null;
}

describe('updateOctree', () => {
  it('returns just the coarse root when the camera is far away', () => {
    const leaves = updateOctree(SELA, { x: 0, y: 0, z: 3000 });
    expect(leaves.length).toBe(1);
    expect(leaves[0]?.level).toBe(SELA.lodMaxLevel);
  });

  it('gives level-0 leaves around a camera at the surface', () => {
    const camera = { x: 0, y: SELA.radius + 2, z: 0 };
    const leaves = updateOctree(SELA, camera);
    const containing = leafContaining(leaves, camera.x, camera.y, camera.z);
    expect(containing).not.toBeNull();
    expect(containing?.level).toBe(0);
    // Neighbors close to the camera also refine to the finest level.
    for (const leaf of leaves) {
      const dx = leaf.center.x - camera.x;
      const dy = leaf.center.y - camera.y;
      const dz = leaf.center.z - camera.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 24) {
        expect(leaf.level).toBe(0);
      }
    }
  });

  it('gives level-0 leaves around a camera deep inside (core chamber)', () => {
    const camera = { x: 0, y: 0, z: 0 };
    const leaves = updateOctree(SELA, camera);
    const containing = leafContaining(leaves, camera.x, camera.y, camera.z);
    expect(containing).not.toBeNull();
    expect(containing?.level).toBe(0);
  });

  it('covers the root with no overlaps', () => {
    const camera = { x: 100, y: SELA.radius + 50, z: -200 };
    const leaves = updateOctree(SELA, camera);
    const size = rootSize(SELA);
    // Volumes add up to exactly the root volume.
    let volume = 0;
    for (const leaf of leaves) volume += leaf.size ** 3;
    expect(volume).toBe(size ** 3);
    // No two leaves overlap.
    for (let i = 0; i < leaves.length; i += 1) {
      const a = leaves[i] as OctreeNode;
      for (let j = i + 1; j < leaves.length; j += 1) {
        const b = leaves[j] as OctreeNode;
        expect(boxesOverlap(a.min, a.size, b.min, b.size)).toBe(false);
      }
    }
    // A grid of sample points is covered exactly once.
    for (let x = -500; x <= 500; x += 100) {
      for (let y = -500; y <= 500; y += 100) {
        for (let z = -500; z <= 500; z += 100) {
          const hits = leaves.filter(
            (leaf) =>
              x >= leaf.min.x &&
              x < leaf.min.x + leaf.size &&
              y >= leaf.min.y &&
              y < leaf.min.y + leaf.size &&
              z >= leaf.min.z &&
              z < leaf.min.z + leaf.size,
          );
          // Points on the outer root boundary belong to no leaf; interior
          // points belong to exactly one.
          if (x < 512 && y < 512 && z < 512) expect(hits.length).toBe(1);
        }
      }
    }
  });

  it('is deterministic for the same camera position', () => {
    const camera = { x: 50, y: 300, z: 120 };
    const a = updateOctree(SELA, camera).map((leaf) => nodeKey(SELA.id, leaf.level, leaf.coord));
    const b = updateOctree(SELA, camera).map((leaf) => nodeKey(SELA.id, leaf.level, leaf.coord));
    expect(a).toEqual(b);
  });

  it('parent volume equals the union of its children', () => {
    const root = createRoot(SELA);
    const children = childrenOf(SELA, root);
    expect(children.length).toBe(8);
    expect(children[0]?.level).toBe(SELA.lodMaxLevel - 1);
    let volume = 0;
    for (const child of children) volume += child.size ** 3;
    expect(volume).toBe(root.size ** 3);
  });
});

describe('nodesAtLevel', () => {
  it('enumerates 1 root, 8 children, and the full L3 shell set', () => {
    expect(nodesAtLevel(SELA, SELA.lodMaxLevel).length).toBe(1);
    expect(nodesAtLevel(SELA, SELA.lodMaxLevel - 1).length).toBe(8);
    expect(nodesAtLevel(SELA, SELA.lodMaxLevel - 2).length).toBe(64);
    expect(nodesAtLevel(SELA, 0).length).toBe(32 ** 3);
  });
});

describe('classifyNode', () => {
  const field = createDensityField(SELA, 1337);

  it('labels constant fields solid, air, or mixed', () => {
    const node = nodesAtLevel(SELA, 1)[0] as OctreeNode;
    expect(classifyNode(() => 500, node)).toBe('solid');
    expect(classifyNode(() => -500, node)).toBe('air');
    // A plane through the node middle: corners disagree -> not skippable.
    const mid = node.min.x + node.size / 2;
    expect(classifyNode((x) => x - mid, node)).toBeNull();
    // Inside the margin on one side only -> not skippable either.
    expect(classifyNode(() => node.size, node)).toBeNull();
  });

  it('air verdicts agree with dense sampling on every level-1 node', () => {
    // Safety property for the only skip the streamer trusts: whenever the
    // node reads 'air', a 5x5x5 sub-grid must confirm the sign. 'solid'
    // verdicts are not asserted here (and none occur on Sela: carved rock
    // reads at most ~(2-threshold)*10, far below any L1+ margin, so
    // worm-adjacent nodes honestly report null and queue for exact meshing).
    let air = 0;
    for (const node of nodesAtLevel(SELA, 1)) {
      if (classifyNode(field.density, node) !== 'air') continue;
      let max = -Infinity;
      for (let ix = 0; ix <= 4; ix += 1) {
        for (let iy = 0; iy <= 4; iy += 1) {
          for (let iz = 0; iz <= 4; iz += 1) {
            const d = field.density(
              node.min.x + (ix / 4) * node.size,
              node.min.y + (iy / 4) * node.size,
              node.min.z + (iz / 4) * node.size,
            );
            if (d > max) max = d;
          }
        }
      }
      expect(max).toBeLessThan(0);
      air += 1;
    }
    // High air columns above the planet still skip.
    expect(air).toBeGreaterThan(0);
  });

  it('regression: a worm-threaded node reads null, never solid or air-skipped', () => {
    // Seed 1337 probe: dense sampling finds d ~= -1.3 inside this L1 node
    // (a thin cave worm threads it), so the honest verdict is null: the
    // node queues for exact meshing and is never treated as empty. (Before
    // the unconditional-carve fix, all 9 samples read strongly solid and
    // the node falsely reported 'solid'.)
    const nodes = nodesAtLevel(SELA, 1);
    const worm = nodes.find((node) => node.min.x === -256 && node.min.y === -64 && node.min.z === -64);
    expect(worm).toBeDefined();
    if (worm) {
      expect(classifyNode(field.density, worm)).toBeNull();
      expect(isDefinitelyAir(field.density, worm)).toBe(false);
    }
  });

  it('does not skip nodes crossing the surface', () => {
    const camera = { x: 0, y: SELA.radius, z: 0 };
    const leaves = updateOctree(SELA, camera);
    const surface = leafContaining(leaves, 0, SELA.radius, 0);
    expect(surface).not.toBeNull();
    if (surface) {
      expect(surface).not.toBeNull();
      expect(isDefinitelyAir(field.density, surface)).toBe(false);
    }
  });
});
