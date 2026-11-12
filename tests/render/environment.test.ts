// M05 render-object tests: LightingRig, Sky, Atmosphere and LOD shadow
// flags. Headless (constructs objects, never renders, so no GL needed).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import { ATMOSPHERE, FOG_CAVE_DENSITY, FOG_SURFACE_DENSITY } from '../../src/core/constants.js';
import { nodeKey, nodeOrigin } from '../../src/terrain/octree.js';
import type { MeshResult } from '../../src/terrain/workerPool.js';
import { maybeShiftOrigin, resetOrigin, toLocal } from '../../src/render/floatingOrigin.js';
import { Atmosphere } from '../../src/render/atmosphere.js';
import { ChunkMeshes } from '../../src/render/chunkMeshes.js';
import { LightingRig } from '../../src/render/lighting.js';
import { Sky, SUN_DISC_DISTANCE } from '../../src/render/sky.js';

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
    // M05 night restored (M13 review): the far planet has its own emissive
    // glow, so the local key light stays fully off below the horizon.
    expect(rig.sun.intensity).toBe(0);
    expect(rig.headlamp.visible).toBe(false);
    // Night, deep underground: dim floor of the day fill, depth-scaled.
    expect(rig.hemi.intensity).toBeCloseTo(0.06 * 0.08, 10);
    rig.dispose();
  });

  it('repositions the sun and shadow target from world doubles after an origin shift', () => {
    resetOrigin();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 200000);
    const rig = new LightingRig(scene, camera);
    // Jump the floating origin to Vorn (as the Sela -> Vorn flight does).
    expect(maybeShiftOrigin(VORN.center)).not.toBe(null);
    const focus = {
      x: VORN.center.x + 10,
      y: VORN.center.y + VORN.radius,
      z: VORN.center.z,
    };
    rig.update({
      sunDirWorld: { x: 1, y: 0, z: 0 },
      focusWorld: focus,
      elevation: 1,
      depthBelowM: 0,
      headlampOn: false,
      skyTint: DAY,
      groundTint: [0.6, 0.55, 0.45],
    });
    const local = toLocal(focus);
    // Texel snapping stays within one texel (<1 m at 64 m / 2048).
    expect(rig.sun.target.position.x).toBeCloseTo(local.x, 0);
    expect(rig.sun.target.position.y).toBeCloseTo(local.y, 0);
    expect(rig.sun.target.position.z).toBeCloseTo(local.z, 0);
    // The sun sits 250 m along +X from the (snapped) shadow focus.
    expect(rig.sun.position.x).toBeCloseTo(rig.sun.target.position.x + 250, 0);
    rig.dispose();
    resetOrigin();
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

  it('keeps stars and the sun disc on the camera after an origin shift', () => {
    resetOrigin();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 200000);
    const sky = new Sky(scene, camera, 1337);
    expect(maybeShiftOrigin({ x: 2016, y: 0, z: 0 })).not.toBe(null);
    // The renderer keeps the camera in local coordinates after a shift.
    camera.position.set(10, 20, 600);
    sky.update({
      sunDirWorld: { x: 0, y: 1, z: 0 },
      elevation: 1,
      altitudeM: 0,
      depthBelowM: 0,
      dayColor: DAY,
    });
    const stars = scene.children.find((child) => child instanceof THREE.Points) as
      | THREE.Points
      | undefined;
    const disc = scene.children.find((child) => child instanceof THREE.Mesh) as
      | THREE.Mesh
      | undefined;
    if (!stars || !disc) throw new Error('sky objects missing');
    expect(stars.position.x).toBeCloseTo(10, 6);
    expect(stars.position.y).toBeCloseTo(20, 6);
    expect(disc.position.x).toBeCloseTo(10, 6);
    expect(disc.position.y).toBeCloseTo(20 + SUN_DISC_DISTANCE, 6);
    sky.dispose();
    resetOrigin();
  });
});

describe('Atmosphere', () => {
  it('uses a thin blue scattering profile without an opaque shell or depth writes', () => {
    const scene = new THREE.Scene();
    const atmosphere = new Atmosphere(scene);
    atmosphere.addPlanet(SELA);
    const mesh = scene.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.ShaderMaterial;
    expect(mat.depthWrite).toBe(false);
    expect(mat.depthTest).toBe(true);
    expect(mat.blendSrc).toBe(THREE.OneFactor);
    expect(mat.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(mat.uniforms['atmosphereHeight']?.value).toBe(SELA.atmosphere.height);
    expect(mat.uniforms['scaleHeight']?.value).toBeCloseTo(SELA.atmosphere.height * ATMOSPHERE.scaleHeightFraction);
    const beta = mat.uniforms['rayleigh']?.value as THREE.Vector3;
    expect(beta.z).toBeGreaterThan(beta.y);
    expect(beta.y).toBeGreaterThan(beta.x);
    atmosphere.update({ x: 0, y: 2, z: 0 }, 40);
    expect(mat.uniforms['visibility']?.value).toBe(0);
    expect((mat.uniforms['sunDirection']?.value as THREE.Vector3).length()).toBeCloseTo(1);
    atmosphere.update({ x: 0, y: 1, z: 0 }, 0);
    expect(mat.uniforms['visibility']?.value).toBe(1);
    atmosphere.dispose();
  });

  it('tracks the planet center and the sun direction', () => {
    resetOrigin();
    const scene = new THREE.Scene();
    const atmosphere = new Atmosphere(scene);
    atmosphere.addPlanet(SELA);
    atmosphere.update({ x: 0, y: 1, z: 0 });
    const mesh = scene.children[0] as THREE.Mesh;
    expect(mesh.position.length()).toBe(0);
    // Proxy follows configured air height; its outer edge has zero density.
    mesh.geometry.computeBoundingSphere();
    expect(mesh.geometry.boundingSphere?.radius).toBeCloseTo(
      SELA.radius + SELA.atmosphere.height,
      0,
    );
    const mat = mesh.material as THREE.ShaderMaterial;
    const sun = mat.uniforms['sunDirection'] as { value: THREE.Vector3 };
    expect(sun.value.y).toBeCloseTo(1, 10);
    atmosphere.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('repositions both shells from world doubles after an origin shift', () => {
    resetOrigin();
    const scene = new THREE.Scene();
    const atmosphere = new Atmosphere(scene);
    atmosphere.addPlanet(SELA);
    atmosphere.addPlanet(VORN);
    // Jump the floating origin to Vorn (as the Sela -> Vorn flight does).
    expect(maybeShiftOrigin(VORN.center)).not.toBe(null);
    atmosphere.update({ x: 0, y: 1, z: 0 });
    const positions = scene.children.map((child) => (child as THREE.Mesh).position.clone());
    for (const child of scene.children) {
      const mesh = child as THREE.Mesh;
      const material = mesh.material as THREE.ShaderMaterial;
      const uniformCenter = material.uniforms['planetCenter']?.value as THREE.Vector3;
      expect(uniformCenter.distanceTo(mesh.position)).toBeLessThan(1e-6);
    }
    const vornLocal = toLocal(VORN.center);
    const selaLocal = toLocal(SELA.center);
    const near = (p: THREE.Vector3, q: { x: number; y: number; z: number }): number =>
      Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    expect(positions.some((p) => near(p, vornLocal) < 0.01)).toBe(true);
    expect(positions.some((p) => near(p, selaLocal) < 0.01)).toBe(true);
    expect(Math.hypot(selaLocal.x, selaLocal.y, selaLocal.z)).toBeGreaterThan(10000);
    atmosphere.dispose();
    resetOrigin();
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
