// Render-side chunk meshes: one THREE.Mesh per worker MeshResult, all
// sharing a flat-shaded vertex-color material. Positions are stored in
// world-space doubles; every mesh is placed via the floating origin.

import * as THREE from 'three';
import { CHUNK_CACHE_BUDGET } from '../core/constants.js';
import type { Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { toLocal } from './floatingOrigin.js';
import type { MeshResult } from '../terrain/workerPool.js';

export class ChunkMeshes {
  readonly group = new THREE.Group();
  private readonly material: THREE.Material;
  private readonly meshes = new Map<string, THREE.Mesh>();
  /** Chunk-origin world position per key (for origin re-sync). */
  private readonly worldPos = new Map<string, Vec3d>();
  /** Insertion order for LRU eviction. */
  private readonly lru: string[] = [];

  constructor() {
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 1,
      metalness: 0,
    });
    this.group.name = 'chunks';
  }

  get count(): number {
    return this.meshes.size;
  }

  /** Add a mesh; returns false when the result was empty or a duplicate. */
  add(config: PlanetConfig, result: MeshResult): boolean {
    if (result.empty) return false;
    if (this.meshes.has(result.key)) return false;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(result.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(result.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(result.indices, 1));
    const mesh = new THREE.Mesh(geometry, this.material);
    // Worker origin is planet-local; world = center + local (Sela center 0).
    const world: Vec3d = {
      x: config.center.x + result.origin.x,
      y: config.center.y + result.origin.y,
      z: config.center.z + result.origin.z,
    };
    this.worldPos.set(result.key, world);
    const local = toLocal(world);
    mesh.position.set(local.x, local.y, local.z);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.meshes.set(result.key, mesh);
    this.group.add(mesh);
    this.lru.push(result.key);
    this.evictIfNeeded();
    return true;
  }

  /** Reposition every mesh from world doubles (call after origin shifts). */
  syncAll(): void {
    for (const [key, mesh] of this.meshes) {
      const world = this.worldPos.get(key);
      if (!world) continue;
      const local = toLocal(world);
      mesh.position.set(local.x, local.y, local.z);
      mesh.updateMatrix();
    }
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.meshes.clear();
    this.worldPos.clear();
    this.lru.length = 0;
    this.material.dispose();
  }

  private evictIfNeeded(): void {
    while (this.lru.length > CHUNK_CACHE_BUDGET) {
      const key = this.lru.shift() as string;
      const mesh = this.meshes.get(key);
      if (!mesh) continue;
      mesh.geometry.dispose();
      this.group.remove(mesh);
      this.meshes.delete(key);
      this.worldPos.delete(key);
    }
  }
}
