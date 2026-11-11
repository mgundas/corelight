// Density field tests: determinism, sign conventions, core carving, layers.
// WHY: the same seed must always build the same planet (saves, co-op).

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { cavernAnchorPoints, cavernStack, createDensityFn, layerAt, surfaceDepthAt } from '../../src/terrain/density.js';

describe('density', () => {
  it('is deterministic for the same seed', () => {
    const a = createDensityFn(SELA, 1337);
    const b = createDensityFn(SELA, 1337);
    const points = [
      [0, 400, 0],
      [100, 350, -50],
      [0, 0, 200],
      [0, 43, 0],
      [250, -250, 100],
    ] as const;
    for (const [x, y, z] of points) {
      expect(a(x, y, z)).toBe(b(x, y, z));
    }
  });

  it('differs for different world seeds', () => {
    const a = createDensityFn(SELA, 1337);
    const b = createDensityFn(SELA, 4242);
    // Surface relief is seeded: at least one probe point must differ.
    const points = [
      [0, 400, 0],
      [300, 200, 100],
      [-150, -350, 80],
      [50, 390, -30],
    ] as const;
    const same = points.every(([x, y, z]) => a(x, y, z) === b(x, y, z));
    expect(same).toBe(false);
  });

  it('is negative far above the surface', () => {
    const density = createDensityFn(SELA, 1337);
    expect(density(0, SELA.radius + 100, 0)).toBeLessThan(0);
  });

  it('is negative at the planet center (hollow core chamber)', () => {
    const density = createDensityFn(SELA, 1337);
    expect(density(0, 0, 0)).toBeLessThan(0);
  });

  it('is positive in the core shell', () => {
    const density = createDensityFn(SELA, 1337);
    const r = SELA.core.chamberRadius + SELA.core.shellThickness / 2;
    expect(density(0, r, 0)).toBeGreaterThan(0);
  });

  it('maps depth to layers', () => {
    // Points on +Y: depth = radius - r.
    expect(layerAt(SELA, 0, SELA.radius - 10, 0).name).toBe('surface');
    expect(layerAt(SELA, 0, SELA.radius - 80, 0).name).toBe('crust');
    expect(layerAt(SELA, 0, SELA.radius - 200, 0).name).toBe('mantle');
  });

  it('maps the core shell and chamber to pseudo-layers', () => {
    const rShell = SELA.core.chamberRadius + SELA.core.shellThickness / 2;
    const shell = layerAt(SELA, 0, rShell, 0);
    expect(shell.kind).toBe('core_shell');
    expect(shell.hardness).toBe(SELA.core.shellHardness);
    const chamber = layerAt(SELA, 0, 0, 0);
    expect(chamber.kind).toBe('core_chamber');
  });
});

describe('cavernStack', () => {
  it('derives seven floors for Sela that fit above the core shell', () => {
    const stack = cavernStack(SELA);
    expect(stack.start).toBe(SELA.caverns.surfaceCapDepth);
    expect(stack.pitch).toBe(
      SELA.caverns.cavernHeight + SELA.caverns.slabThickness,
    );
    // usable = 400 - 40 - 6 - 30 = 324; pitch = 14 + 32 = 46 -> 7 floors.
    expect(stack.count).toBe(7);
    const shellOuterDepth =
      SELA.radius - SELA.core.chamberRadius - SELA.core.shellThickness;
    expect(stack.start + stack.count * stack.pitch).toBeLessThanOrEqual(shellOuterDepth);
  });
});

describe('cavern floors', () => {
  it('opens every floor: anchor pockets plus blotch rooms', () => {
    const density = createDensityFn(SELA, 1337);
    const stack = cavernStack(SELA);
    // The guaranteed pocket per floor is always open at its center.
    for (const anchor of cavernAnchorPoints(SELA)) {
      expect(density(anchor.x, anchor.y, anchor.z)).toBeLessThan(0);
    }
    // Blotches open additional rooms beyond the anchors: floor 0 is
    // mostly rock with some open room near the pole.
    const depth = stack.start + stack.cavernHeight / 2;
    const y = SELA.radius - depth;
    let open = 0;
    let n = 0;
    for (let x = -150; x <= 150; x += 10) {
      for (let z = -150; z <= 150; z += 10) {
        const r = Math.hypot(x, y, z);
        if (Math.abs(SELA.radius - r - depth) > 5) continue;
        n += 1;
        if (density(x, y, z) < 0) open += 1;
      }
    }
    expect(n).toBeGreaterThan(0);
    const frac = open / n;
    expect(frac).toBeGreaterThan(0);
    expect(frac).toBeLessThan(0.5);
  });

  it('keeps slabs mostly solid with real openings', () => {
    const density = createDensityFn(SELA, 1337);
    const stack = cavernStack(SELA);
    // Slab-middle samples (by true band position): mostly rock, but worms
    // genuinely pierce the slabs (the diggable openings).
    let slab = 0;
    let slabAir = 0;
    for (let x = -120; x <= 120; x += 10) {
      for (let z = -120; z <= 120; z += 10) {
        for (let i = 0; i < stack.count; i += 1) {
          const y = SELA.radius - (stack.start + i * stack.pitch + stack.cavernHeight + 12);
          const depth = SELA.radius - Math.hypot(x, y, z);
          const dd = depth - stack.start;
          if (dd < 0) continue;
          const idx = Math.floor(dd / stack.pitch);
          if (idx !== i) continue;
          const u = dd - idx * stack.pitch;
          if (u < stack.cavernHeight + 6 || u > stack.cavernHeight + 18) continue;
          slab += 1;
          if (density(x, y, z) < 0) slabAir += 1;
        }
      }
    }
    expect(slab).toBeGreaterThan(100);
    const airFrac = slabAir / slab;
    // Solid slabs punctured by openings: neither solid rock nor Swiss cheese.
    expect(airFrac).toBeGreaterThan(0);
    expect(airFrac).toBeLessThan(0.3);
  });

  it('lays walkable floors: present everywhere, gentle, pits never breach', () => {
    const density = createDensityFn(SELA, 1337);
    const stack = cavernStack(SELA);
    const lo = stack.start + stack.cavernHeight - 4;
    const hi = stack.start + stack.cavernHeight + 8;
    // 2 m grid over a 24x24 m patch inside floor 0's anchor pocket: first
    // solid going down, starting inside room air (just under the room top).
    const anchor = (cavernAnchorPoints(SELA)[0] as { x: number; y: number; z: number });
    const step = 2;
    const half = 12;
    const grid: number[][] = [];
    let inBand = 0;
    let total = 0;
    for (let ix = 0; ix <= half * 2; ix += step) {
      const row: number[] = [];
      for (let iz = 0; iz <= half * 2; iz += step) {
        const x = anchor.x - half + ix;
        const z = anchor.z - half + iz;
        let fy = -1;
        for (let y = SELA.radius - 36; y >= SELA.radius - 90; y -= 0.5) {
          if (density(x, y, z) >= 0) { fy = y; break; }
        }
        row.push(fy);
        total += 1;
        if (fy < 0) continue;
        const depth = SELA.radius - Math.hypot(x, fy, z);
        if (depth >= lo && depth <= hi) inBand += 1;
      }
      grid.push(row);
    }
    // The floor exists almost everywhere in the patch (no missing floor,
    // no deep shafts): pits dip but stay inside their band. (Probed: 93%.)
    expect(inBand / total).toBeGreaterThan(0.85);
    // Slopes from the heightfield stay climbable almost everywhere.
    let steep = 0;
    let counted = 0;
    const n = grid.length;
    for (let ix = 1; ix < n - 1; ix += 1) {
      for (let iz = 1; iz < n - 1; iz += 1) {
        const f = (grid[ix] as number[])[iz] as number;
        const fx1 = (grid[ix + 1] as number[])[iz] as number;
        const fx0 = (grid[ix - 1] as number[])[iz] as number;
        const fz1 = (grid[ix] as number[])[iz + 1] as number;
        const fz0 = (grid[ix] as number[])[iz - 1] as number;
        if (f < 0 || fx1 < 0 || fx0 < 0 || fz1 < 0 || fz0 < 0) continue;
        const gx = (fx1 - fx0) / (2 * step);
        const gz = (fz1 - fz0) / (2 * step);
        counted += 1;
        if (Math.atan(Math.hypot(gx, gz)) > (50 * Math.PI) / 180) steep += 1;
      }
    }
    expect(counted).toBeGreaterThan(0);
    // Probed: ~6% of interior heightfield edges exceed the climb angle
    // (pit rims and worm mouths); the rest walks.
    expect(steep / counted).toBeLessThan(0.1);
  }, 30000);
});

describe('noise cache', () => {
  it('rebuilds evicted entries bit-identically (cap never changes terrain)', () => {
    const probe = { x: 12.5, y: SELA.radius - 42.25, z: -7.75 };
    const before = surfaceDepthAt(SELA, 4242, probe.x, probe.y, probe.z);
    // Flood the cache past NOISE_CACHE_BUDGET with foreign seeds so the
    // probe's entry is evicted and rebuilt on the next call.
    for (let seed = 100000; seed < 100200; seed += 1) {
      surfaceDepthAt(SELA, seed, probe.x, probe.y, probe.z);
    }
    expect(surfaceDepthAt(SELA, 4242, probe.x, probe.y, probe.z)).toBe(before);
  });
});
