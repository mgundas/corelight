// Repro for "the entire chunk updates when I dig": prove the LOD0 owner
// remesh is local (only triangles near the brush may change). If this
// passes while the in-game glitch spans the whole chunk, the glitch comes
// from elsewhere (the LOD1 parent refresh overlapping the fine children).

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { colorAt, createDensityField } from '../../src/terrain/density.js';
import { TerrainEdits } from '../../src/terrain/edits.js';
import { polygonize } from '../../src/terrain/marchingCubes.js';
import { nodeOrigin } from '../../src/terrain/octree.js';
import { sampleGrid } from '../../src/terrain/sampleGrid.js';

function triKeys(
  positions: Float32Array,
  indices: Uint32Array,
  origin: { x: number; y: number; z: number },
): { key: string; cx: number; cy: number; cz: number }[] {
  const out: { key: string; cx: number; cy: number; cz: number }[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const parts: string[] = [];
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 3; k += 1) {
      const v = (indices[t + k] as number) * 3;
      const x = (positions[v] as number) + origin.x;
      const y = (positions[v + 1] as number) + origin.y;
      const z = (positions[v + 2] as number) + origin.z;
      parts.push(`${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`);
      cx += x / 3;
      cy += y / 3;
      cz += z / 3;
    }
    parts.sort();
    out.push({ key: parts.join('|'), cx, cy, cz });
  }
  return out;
}

describe('edit remesh locality', () => {
  it('changes only triangles near the brush (LOD0 owner swap is local)', () => {
    const seed = 1337;
    const field = createDensityField(SELA, seed);
    const coord = { x: 16, y: 28, z: 16 };
    const origin = nodeOrigin(SELA, 0, coord);
    // Brush center 1 m under the surface, middle of the chunk.
    const cx = origin.x + 16;
    const cz = origin.z + 16;
    let surfaceY = origin.y + 32;
    while (surfaceY > origin.y && field.density(cx, surfaceY, cz) < 0) surfaceY -= 0.5;
    const center = { x: cx, y: surfaceY - 1, z: cz };
    const radius = 2;
    // Sanity: the brush sits inside this chunk's territory.
    expect(center.x).toBeGreaterThanOrEqual(origin.x);
    expect(center.x).toBeLessThanOrEqual(origin.x + 32);

    const salt = `${seed}:${SELA.seed}:color`;
    const before = sampleGrid(field, SELA, 0, coord, 1);
    const mesh0 = polygonize(
      before.samples,
      before.origin,
      1,
      (x, y, z, nx, ny, nz) => colorAt(SELA, x, y, z, nx, ny, nz, salt),
      { skirts: true },
    );
    expect(mesh0.empty).toBe(false);

    const edits = new TerrainEdits();
    const outcome = edits.applySphere(SELA, field.density, center, radius, 0.5, 'dig', {});
    expect(outcome.keys.length).toBeGreaterThan(0);
    const attach = edits.deltasForJob(SELA, 0, coord);
    expect(attach).not.toBe(null);
    const samples = before.samples.slice();
    const att = attach as { indices: Uint32Array; values: Float32Array };
    for (let k = 0; k < att.indices.length; k += 1) {
      const at = att.indices[k] as number;
      samples[at] = (samples[at] as number) + (att.values[k] as number);
    }
    const mesh1 = polygonize(
      samples,
      before.origin,
      1,
      (x, y, z, nx, ny, nz) => colorAt(SELA, x, y, z, nx, ny, nz, salt),
      { skirts: true },
    );

    const set0 = new Map(triKeys(mesh0.positions, mesh0.indices, origin).map((t) => [t.key, t]));
    const set1 = new Map(triKeys(mesh1.positions, mesh1.indices, origin).map((t) => [t.key, t]));
    // The edit must have an effect (sanity: the hole exists).
    expect(set1.size).toBeGreaterThan(0);
    let changedInside = 0;
    for (const [key, t] of set0) {
      if (set1.has(key)) continue;
      const d = Math.hypot(t.cx - center.x, t.cy - center.y, t.cz - center.z);
      if (d > radius + 2) {
        throw new Error(`triangle ${d.toFixed(2)} m from the brush changed`);
      }
      changedInside += 1;
    }
    for (const [key, t] of set1) {
      if (set0.has(key)) continue;
      const d = Math.hypot(t.cx - center.x, t.cy - center.y, t.cz - center.z);
      if (d > radius + 2) {
        throw new Error(`new triangle ${d.toFixed(2)} m from the brush appeared`);
      }
    }
    expect(changedInside).toBeGreaterThan(0);
  });
});
