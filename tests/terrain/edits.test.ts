// Unit tests for the sparse terrain edit store: brush application,
// determinism, clamping, hardness filtering, soil accounting, flatten,
// worker attachments (LOD0 copy, LOD1 average, higher ignore), and
// serialization.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { sampleIndex } from '../../src/terrain/density.js';
import { TerrainEdits } from '../../src/terrain/edits.js';
import { rootMin } from '../../src/terrain/octree.js';

/** Constant base-density stub: edits behave identically everywhere. */
const solid2 = (): number => 2;
const air2 = (): number => -2;

describe('TerrainEdits.applySphere', () => {
  it('digs a spherical falloff, strongest at the center', () => {
    const edits = new TerrainEdits();
    const min = rootMin(SELA);
    const center = { x: min.x + 512, y: min.y + 512, z: min.z + 512 };
    const out = edits.applySphere(SELA, solid2, center, 2, 1, 'dig');
    expect(out.keys.length).toBeGreaterThan(0);
    expect(edits.deltaAt(SELA, SELA.id, center.x, center.y, center.z)).toBeCloseTo(-1);
    expect(edits.deltaAt(SELA, SELA.id, center.x + 1, center.y, center.z)).toBeCloseTo(-0.25);
    // Outside the radius nothing is stored.
    expect(edits.deltaAt(SELA, SELA.id, center.x + 3, center.y, center.z)).toBe(0);
  });

  it('add is the reverse of dig', () => {
    const edits = new TerrainEdits();
    const min = rootMin(SELA);
    const center = { x: min.x + 512, y: min.y + 512, z: min.z + 512 };
    edits.applySphere(SELA, solid2, center, 2, 1, 'add');
    expect(edits.deltaAt(SELA, SELA.id, center.x, center.y, center.z)).toBeCloseTo(1);
  });

  it('interpolates between lattice samples instead of snapping', () => {
    const edits = new TerrainEdits();
    const min = rootMin(SELA);
    const g = { x: 100, y: 200, z: 300 };
    const center = { x: min.x + g.x, y: min.y + g.y, z: min.z + g.z };
    edits.applySphere(SELA, solid2, center, 0.5, 2, 'dig');
    // Exact sample holds the full delta; halfway to the (empty) neighbour
    // reads half (trilinear). Nearest-sample would read -2 or 0 here.
    expect(edits.deltaAt(SELA, SELA.id, center.x, center.y, center.z)).toBeCloseTo(-2);
    expect(edits.deltaAt(SELA, SELA.id, center.x + 0.5, center.y, center.z)).toBeCloseTo(-1);
    expect(edits.deltaAt(SELA, SELA.id, center.x + 1, center.y, center.z)).toBeCloseTo(0);
  });

  it('clamps deltas to [-4, 4] no matter the strength', () => {
    const edits = new TerrainEdits();
    const min = rootMin(SELA);
    const center = { x: min.x + 100, y: min.y + 100, z: min.z + 100 };
    for (let i = 0; i < 10; i += 1) {
      edits.applySphere(SELA, solid2, center, 2, 100, 'dig');
    }
    expect(edits.deltaAt(SELA, SELA.id, center.x, center.y, center.z)).toBe(-4);
  });

  it('lists only the owner chunk for a brush in the chunk middle', () => {
    const edits = new TerrainEdits();
    const min = rootMin(SELA);
    // Chunk (1,16,16) middle: radius 0.5 touches a single lattice point.
    const g = { x: 1 * 32 + 16, y: 16 * 32 + 16, z: 16 * 32 + 16 };
    const center = { x: min.x + g.x, y: min.y + g.y, z: min.z + g.z };
    const out = edits.applySphere(SELA, solid2, center, 0.5, 1, 'dig');
    expect(out.keys).toEqual(['sela:0:1:16:16']);
  });

  it('returns affected keys including border neighbors', () => {
    const edits = new TerrainEdits();
    const min = rootMin(SELA);
    // Lattice point 1 m inside chunk (1,0,0)'s low edge: the sphere also
    // reaches chunk (0,0,0)'s window, so both (and neighbors) are listed.
    const center = { x: min.x + 32 + 1, y: min.y + 512, z: min.z + 512 };
    const out = edits.applySphere(SELA, solid2, center, 2, 1, 'dig');
    expect(out.keys).toContain('sela:0:1:16:16');
    expect(out.keys).toContain('sela:0:0:16:16');
  });

  it('skips samples above the tool hardness and reports blocked', () => {
    const edits = new TerrainEdits();
    const min = rootMin(SELA);
    const center = { x: min.x + 512, y: min.y + 512, z: min.z + 512 };
    const out = edits.applySphere(SELA, solid2, center, 2, 1, 'dig', {
      maxHardness: 2,
      hardnessAt: () => 5,
    });
    expect(out.blocked).toBe(true);
    expect(out.keys).toHaveLength(0);
    expect(edits.sampleCount).toBe(0);
  });

  it('allows samples at or below the tool hardness', () => {
    const edits = new TerrainEdits();
    const min = rootMin(SELA);
    const center = { x: min.x + 512, y: min.y + 512, z: min.z + 512 };
    const out = edits.applySphere(SELA, solid2, center, 2, 1, 'dig', {
      maxHardness: 2,
      hardnessAt: () => 2,
    });
    expect(out.blocked).toBe(false);
    expect(edits.sampleCount).toBeGreaterThan(0);
  });

  it('counts solid->air flips as gained and air->solid as spent', () => {
    const min = rootMin(SELA);
    const center = { x: min.x + 200, y: min.y + 200, z: min.z + 200 };
    const dug = new TerrainEdits().applySphere(SELA, solid2, center, 1.5, 3, 'dig');
    expect(dug.gained).toBeGreaterThan(0);
    expect(dug.spent).toBe(0);
    const filled = new TerrainEdits().applySphere(SELA, air2, center, 1.5, 3, 'add');
    expect(filled.spent).toBeGreaterThan(0);
  });

  it('soilBudget caps air->solid flips without touching anything else', () => {
    const min = rootMin(SELA);
    const center = { x: min.x + 200, y: min.y + 200, z: min.z + 200 };
    const budgeted = new TerrainEdits().applySphere(SELA, air2, center, 3, 5, 'add', {
      soilBudget: 2,
    });
    expect(budgeted.spent).toBeLessThanOrEqual(2);
    expect(budgeted.spent).toBeGreaterThan(0);
    const unbudgeted = new TerrainEdits().applySphere(SELA, air2, center, 3, 5, 'add');
    expect(unbudgeted.spent).toBeGreaterThan(budgeted.spent);
    // Digging ignores the budget (it earns soil, never spends it).
    const dug = new TerrainEdits().applySphere(SELA, solid2, center, 1.5, 3, 'dig', {
      soilBudget: 0,
    });
    expect(dug.gained).toBeGreaterThan(0);
  });

  it('flatten pulls final density toward the stroke plane', () => {
    const edits = new TerrainEdits();
    const min = rootMin(SELA);
    const center = { x: min.x + 512, y: min.y + 513, z: min.z + 512 };
    // Base density = height: the plane y=512 should become the surface.
    const out = edits.applySphere(SELA, (_x, y) => y - (min.y + 512), center, 2, 10, 'flatten', {
      flattenPlane: { point: { x: center.x, y: min.y + 512, z: center.z }, normal: { x: 0, y: 1, z: 0 } },
    });
    expect(out.gained + out.spent).toBeGreaterThan(0);
    // At the center the brush fully converges: final density = -s = -1.
    const delta = edits.deltaAt(SELA, SELA.id, center.x, center.y, center.z);
    expect(1 + delta).toBeCloseTo(-1);
  });

  it('flatten without a plane is a no-op', () => {
    const edits = new TerrainEdits();
    const min = rootMin(SELA);
    const center = { x: min.x + 512, y: min.y + 512, z: min.z + 512 };
    const out = edits.applySphere(SELA, solid2, center, 2, 1, 'flatten');
    expect(out.keys).toHaveLength(0);
    expect(edits.sampleCount).toBe(0);
  });

  it('same edits give identical stores (deterministic)', () => {
    const run = (): TerrainEdits => {
      const e = new TerrainEdits();
      const min = rootMin(SELA);
      e.applySphere(SELA, solid2, { x: min.x + 512, y: min.y + 512, z: min.z + 512 }, 3, 0.5, 'dig');
      e.applySphere(SELA, solid2, { x: min.x + 520, y: min.y + 512, z: min.z + 512 }, 2, 0.5, 'add');
      return e;
    };
    expect(run().serialize()).toEqual(run().serialize());
  });
});

describe('TerrainEdits.deltasForJob', () => {
  it('resolves an LOD0 edit into the 35^3 grid', () => {
    const edits = new TerrainEdits();
    const min = rootMin(SELA);
    // Exact lattice point: radius 0.5 touches only it.
    const g = { x: 40, y: 520, z: 600 };
    const center = { x: min.x + g.x, y: min.y + g.y, z: min.z + g.z };
    edits.applySphere(SELA, solid2, center, 0.5, 2, 'dig');
    const owner = { x: Math.floor(g.x / 32), y: Math.floor(g.y / 32), z: Math.floor(g.z / 32) };
    const at = edits.deltasForJob(SELA, 0, owner);
    expect(at).not.toBeNull();
    const lx = g.x - owner.x * 32;
    const ly = g.y - owner.y * 32;
    const lz = g.z - owner.z * 32;
    const want = sampleIndex(lx + 1, ly + 1, lz + 1, 35);
    expect([...(at as { indices: Uint32Array }).indices]).toContain(want);
    const pos = [...at!.indices].indexOf(want);
    expect(at!.values[pos]).toBeCloseTo(-2);
  });

  it('averages LOD0 edits into LOD1 samples and ignores higher levels', () => {
    const edits = new TerrainEdits();
    const min = rootMin(SELA);
    const g = { x: 40, y: 520, z: 600 };
    const center = { x: min.x + g.x, y: min.y + g.y, z: min.z + g.z };
    edits.applySphere(SELA, solid2, center, 0.5, 2, 'dig');
    const parent = { x: Math.floor(g.x / 64), y: Math.floor(g.y / 64), z: Math.floor(g.z / 64) };
    const at1 = edits.deltasForJob(SELA, 1, parent);
    expect(at1).not.toBeNull();
    expect(at1!.indices.length).toBe(1);
    expect(at1!.values[0]).toBeCloseTo(-2 / 8);
    expect(edits.deltasForJob(SELA, 2, { x: 0, y: 0, z: 0 })).toBeNull();
  });

  it('includes the far LOD0 cube in the LOD1 border sample', () => {
    // LOD1 border sample 34 averages lattice +66 and +67: clipping hi at
    // +66 halves its cube. A single-sample dig at +67 must still land.
    const edits = new TerrainEdits();
    const min = rootMin(SELA);
    const parent = { x: 2, y: 4, z: 4 };
    const g = { x: parent.x * 64 + 67, y: parent.y * 64, z: parent.z * 64 };
    edits.applySphere(SELA, solid2, { x: min.x + g.x, y: min.y + g.y, z: min.z + g.z }, 0.5, 2, 'dig');
    const at1 = edits.deltasForJob(SELA, 1, parent);
    expect(at1).not.toBeNull();
    expect(at1!.values[0]).toBeCloseTo(-2 / 8);
  });

  it('returns null when the job window holds no edits', () => {
    const edits = new TerrainEdits();
    expect(edits.deltasForJob(SELA, 0, { x: 0, y: 0, z: 0 })).toBeNull();
  });
});

describe('TerrainEdits.serialize', () => {
  it('round-trips through plain JSON', () => {
    const edits = new TerrainEdits();
    const min = rootMin(SELA);
    edits.applySphere(SELA, solid2, { x: min.x + 512, y: min.y + 512, z: min.z + 512 }, 3, 0.7, 'dig');
    const json = JSON.parse(JSON.stringify(edits.serialize()));
    const back = TerrainEdits.deserialize(json);
    expect(back.serialize()).toEqual(edits.serialize());
    expect(back.sampleCount).toBe(edits.sampleCount);
  });

  it('rejects malformed payloads', () => {
    expect(() => TerrainEdits.deserialize(null)).toThrow();
    expect(() => TerrainEdits.deserialize({ version: 2, chunks: {} })).toThrow();
    expect(() => TerrainEdits.deserialize({ version: 1, chunks: { 'bogus': [] } })).toThrow();
    expect(() =>
      TerrainEdits.deserialize({ version: 1, chunks: { 'sela:0:0:0:0': [[-1, 0.5]] } }),
    ).toThrow();
  });
});
