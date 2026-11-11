// M05 render-object tests: LightingRig, Sky, Atmosphere and LOD shadow
// flags. Headless (constructs objects, never renders, so no GL needed).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { ATMOSPHERE_SHELL_MULT } from '../../src/core/constants.js';
import { FOG_CAVE_DENSITY, FOG_SURFACE_DENSITY } from '../../src/core/constants.js';
import { nodeKey, nodeOrigin } from '../../src/terrain/octree.js';
import type { MeshResult } from '../../src/terrain/workerPool.js';
import { resetOrigin } from '../../src/render/floatingOrigin.js';
import { Atmosphere } from '../../src/render/atmosphere.js';
import { ChunkMeshes } from '../../src/render/chunkMeshes.js';
import { LightingRig } from '../../src/render/lighting.js';
import { Sky } from '../../src/render/sky.js';

const DAY: [number, number, number] = [0.5, 0.7, 1];

function result(level: number, coord: { x: number; y: number; z: number }): MeshResult {
  const origin = nodeOrigin(SELA, level, coord);
  return {
    id: 0,
    key: nodeKey(SELA.id, level, coord),
    origin: { ...origin },
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    colors: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]),
    indices: new Uint32Array([0, 1, 2]),
    empty: false,
  };
}

describe('LightingRig', () => {
  it('drives sun, fill and headlamp from sim values', () => {
    resetOrigin();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 200000);
    const rig = new LightingRig(scene, camera);
    rig.update({
      sunDirWorld: { x: 0, y: 1, z: 0 },
      focusWorld: { x: 0, y: 410, z: 0 },
      elevation: 1,
      depthBelowM: 0,
      headlampOn: true,
      skyTint: DAY,
      groundTint: [0.6, 0.55, 0.45],
    });
    expect(rig.sun.intensity).toBeCloseTo(2.2, 10);
    expect(rig.headlamp.visible).toBe(true);
    // The shadow frustum recenters on the focus point.
    expect(rig.sun.target.position.y).toBeCloseTo(410, 0);

    rig.update({
      sunDirWorld: { x: 0, y: -1, z: 0 },
      focusWorld: { x: 0, y: 410, z: 0 },
      elevation: -1,
      depthBelowM: 100,
      headlampOn: false,
      skyTint: DAY,
      groundTint: [0.6, 0.55, 0.45],
    });
    expect(rig.sun.intensity).toBe(0);
    expect(rig.headlamp.visible).toBe(false);
    // Night, deep underground: dim floor of the day fill, depth-scaled.
    expect(rig.hemi.intensity).toBeCloseTo(0.06 * 0.08, 10);
    rig.dispose();
  });
});

describe('Sky', () => {
  it('updates background, fog and stars without rendering', () => {
    resetOrigin();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 200000);
    const sky = new Sky(scene, camera, 1337);
    sky.update({ sunDirWorld: { x: 0, y: 1, z: 0 }, elevation: 1, altitudeM: 0, depthBelowM: 0, dayColor: DAY });
    expect((scene.fog as THREE.FogExp2).density).toBeCloseTo(FOG_SURFACE_DENSITY, 6);
    sky.update({ sunDirWorld: { x: 0, y: 1, z: 0 }, elevation: 1, altitudeM: 0, depthBelowM: 100, dayColor: DAY });
    expect((scene.fog as THREE.FogExp2).density).toBeCloseTo(FOG_CAVE_DENSITY, 6);
    sky.update({ sunDirWorld: { x: 0, y: -1, z: 0 }, elevation: -1, altitudeM: 0, depthBelowM: 0, dayColor: DAY });
    const bg = scene.background as THREE.Color;
    expect(bg.r + bg.g + bg.b).toBeLessThan(0.2);
    sky.dispose();
    expect(scene.fog).toBe(null);
  });
});

describe('Atmosphere', () => {
  it('tracks the planet center and the sun direction', () => {
    resetOrigin();
    const scene = new THREE.Scene();
    const atmosphere = new Atmosphere(scene);
    atmosphere.addPlanet(SELA);
    atmosphere.update({ x: 0, y: 1, z: 0 });
    const mesh = scene.children[0] as THREE.Mesh;
    expect(mesh.position.length()).toBe(0);
    // Shell sits just off the surface (multiplier, not a loose bubble).
    mesh.geometry.computeBoundingSphere();
    expect(mesh.geometry.boundingSphere?.radius).toBeCloseTo(
      SELA.radius * ATMOSPHERE_SHELL_MULT,
      0,
    );
    const mat = mesh.material as THREE.ShaderMaterial;
    const sun = mat.uniforms['sunDirection'] as { value: THREE.Vector3 };
    expect(sun.value.y).toBeCloseTo(1, 10);
    atmosphere.dispose();
    expect(scene.children.length).toBe(0);
  });
});

describe('chunk shadow flags', () => {
  it('casts shadows only on the two finest LODs', () => {
    resetOrigin();
    const meshes = new ChunkMeshes();
    expect(meshes.add(SELA, result(0, { x: 8, y: 8, z: 8 }))).toBe('added');
    expect(meshes.add(SELA, result(1, { x: 8, y: 8, z: 8 }))).toBe('added');
    expect(meshes.add(SELA, result(2, { x: 4, y: 4, z: 4 }))).toBe('added');
    const flags = meshes.group.children.map((child) => (child as THREE.Mesh).castShadow);
    // Exactly the two fine LODs cast; the coarse shell does not.
    expect(flags.filter(Boolean).length).toBe(2);
    expect(flags).toContain(false);
    meshes.dispose();
  });
});
