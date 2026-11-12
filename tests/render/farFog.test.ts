// M13: only the camera's planet keeps scene fog. From Sela's surface Vorn is
// ~12.7 km away, where FogExp2 would erase it entirely; the far planet's
// material disables fog and flips (with one shader recompile) only when the
// camera crosses between planets.

import { describe, expect, it } from 'vitest';
import type { Mesh, MeshStandardMaterial } from 'three';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { ChunkMeshes } from '../../src/render/chunkMeshes.js';
import { resetOrigin } from '../../src/render/floatingOrigin.js';
import { nodeKey, nodeOrigin } from '../../src/terrain/octree.js';
import type { MeshResult } from '../../src/terrain/workerPool.js';

function resultFor(planet: PlanetConfig, coord: { x: number; y: number; z: number }): MeshResult {
  const level = 4;
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

function materialOf(meshes: ChunkMeshes, key: string): MeshStandardMaterial {
  const mesh = meshes.group.children.find((child) => child.userData['chunkKey'] === key) as Mesh | undefined;
  if (!mesh) throw new Error(`no mesh for ${key}`);
  return mesh.material as MeshStandardMaterial;
}

describe('far-planet fog', () => {
  it('keeps fog on the near planet only and flips when the camera crosses', () => {
    resetOrigin();
    const meshes = new ChunkMeshes();
    const sela = resultFor(SELA, { x: 1, y: 2, z: 3 });
    const vorn = resultFor(VORN, { x: 0, y: 0, z: 0 });
    meshes.add(SELA, sela);
    meshes.add(VORN, vorn);

    meshes.setFogPlanet('sela');
    expect(materialOf(meshes, sela.key).fog).toBe(true);
    expect(materialOf(meshes, vorn.key).fog).toBe(false);

    meshes.setFogPlanet('vorn');
    expect(materialOf(meshes, sela.key).fog).toBe(false);
    expect(materialOf(meshes, vorn.key).fog).toBe(true);
    meshes.dispose();
  });

  it('does not recompile materials when the near planet is unchanged', () => {
    resetOrigin();
    const meshes = new ChunkMeshes();
    const sela = resultFor(SELA, { x: 1, y: 2, z: 3 });
    meshes.add(SELA, sela);
    meshes.setFogPlanet('sela');
    const material = materialOf(meshes, sela.key);
    const version = material.version;
    // Called every frame by the renderer: must be a no-op after the first.
    meshes.setFogPlanet('sela');
    meshes.setFogPlanet('sela');
    expect(material.version).toBe(version);
    meshes.dispose();
  });
});
