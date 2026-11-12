// M13 floating-origin stress: a Sela -> Vorn flight (~12.7 km) crosses the
// 1000 m shift distance many times. After every shift the chunk meshes must
// re-sync from world doubles; once the origin is over Vorn the local Vorn
// coordinates stay small while Sela is a distant neighbour.

import { describe, expect, it } from 'vitest';
import type { Mesh } from 'three';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import { ChunkMeshes } from '../../src/render/chunkMeshes.js';
import {
  getOrigin,
  maybeShiftOrigin,
  resetOrigin,
  toLocal,
} from '../../src/render/floatingOrigin.js';
import { nodeKey, nodeOrigin } from '../../src/terrain/octree.js';
import type { MeshResult } from '../../src/terrain/workerPool.js';

function result(planet: typeof SELA, level: number, coord: { x: number; y: number; z: number }): MeshResult {
  return {
    id: 0,
    key: nodeKey(planet.id, level, coord),
    origin: { ...nodeOrigin(planet, level, coord) },
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    colors: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]),
    indices: new Uint32Array([0, 1, 2]),
    empty: false,
  };
}

function findMesh(meshes: ChunkMeshes, key: string): Mesh {
  const mesh = meshes.group.children.find((child) => child.userData['chunkKey'] === key) as Mesh | undefined;
  if (!mesh) throw new Error(`no mesh for ${key}`);
  return mesh;
}

describe('Sela -> Vorn origin stress', () => {
  it('shifts many times and re-syncs both planets without drift', () => {
    resetOrigin();
    const meshes = new ChunkMeshes();
    const sela = result(SELA, 5, { x: 0, y: 0, z: 0 });
    const vorn = result(VORN, 5, { x: 0, y: 0, z: 0 });
    meshes.add(SELA, sela);
    meshes.add(VORN, vorn);

    const start = { x: 0, y: SELA.radius, z: 0 };
    const end = { x: VORN.center.x, y: VORN.center.y + VORN.radius, z: VORN.center.z };
    let shifts = 0;
    for (let i = 1; i <= 40; i += 1) {
      const t = i / 40;
      const camera = {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        z: start.z + (end.z - start.z) * t,
      };
      if (maybeShiftOrigin(camera)) {
        shifts += 1;
        meshes.syncAll();
        // Every sync is exact against the authoritative world doubles.
        const worldSela = {
          x: SELA.center.x + sela.origin.x,
          y: SELA.center.y + sela.origin.y,
          z: SELA.center.z + sela.origin.z,
        };
        const want = toLocal(worldSela);
        const got = findMesh(meshes, sela.key).position;
        expect(got.x).toBeCloseTo(want.x, 3);
        expect(got.y).toBeCloseTo(want.y, 3);
        expect(got.z).toBeCloseTo(want.z, 3);
      }
    }
    expect(shifts).toBeGreaterThanOrEqual(10);
    // Origin ended near Vorn: its local chunk origin is small, Sela is far
    // but still exactly placed (float32 has enough precision at ~12.7 km).
    const vornLocal = findMesh(meshes, vorn.key).position;
    expect(Math.abs(vornLocal.x)).toBeLessThan(2048);
    expect(Math.abs(vornLocal.z)).toBeLessThan(2048);
    const selaLocal = findMesh(meshes, sela.key).position;
    expect(Math.hypot(selaLocal.x, selaLocal.y, selaLocal.z)).toBeGreaterThan(10000);
    const origin = getOrigin();
    expect(origin.x).toBeGreaterThan(10000);
    meshes.dispose();
  });
});
