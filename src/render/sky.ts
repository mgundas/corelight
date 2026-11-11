// M05 sky: background color driven by sun elevation and altitude (day blue,
// sunset orange, night dark blue, space black), a seeded star field that
// fades in at night and in space, a simple sun disc, and FogExp2 matched to
// the sky (darker and denser in caves, nearly zero in space). The palette
// math is pure (unit-tested); the class only owns three.js objects.

import * as THREE from 'three';
import {
  DEPTH_FULL_DARK_M,
  FOG_CAVE_DENSITY,
  FOG_SPACE_END_M,
  FOG_SPACE_START_M,
  FOG_SURFACE_DENSITY,
  SKY_SPACE_END_M,
  SKY_SPACE_START_M,
} from '../core/constants.js';
import { clampScalar, smoothstep } from '../core/math.js';
import { createRng } from '../core/rng.js';
import type { Rgb } from '../planets/PlanetConfig.js';
import type { Vec3d } from '../core/math.js';
import { sunColorForElevation } from './lighting.js';

export const STAR_COUNT = 1600;
export const STAR_RADIUS = 60000;
export const SUN_DISC_DISTANCE = 50000;
export const SUN_DISC_RADIUS = 1400;

const NIGHT: Rgb = [0.012, 0.018, 0.045];
const SUNSET: Rgb = [1.0, 0.42, 0.16];

function mix3(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export interface SkyState {
  /** Scene background color (linear RGB). */
  bg: Rgb;
  fogColor: Rgb;
  fogDensity: number;
  /** Star field opacity 0..1. */
  stars: number;
}

/**
 * Palette for a sun elevation (-1..1), an altitude above the nominal surface
 * (meters), a depth below the surface (meters, sim formula), and the
 * planet's day color. Pure: the same inputs always give the same sky.
 */
export function skyStateFor(
  elevation: number,
  altitudeM: number,
  depthBelowM: number,
  dayColor: Rgb,
): SkyState {
  const spaceF = smoothstep(SKY_SPACE_START_M, SKY_SPACE_END_M, altitudeM);
  const dayF = smoothstep(-0.06, 0.3, elevation);
  const duskF = clampScalar(1 - Math.abs(elevation) / 0.18, 0, 1);
  let col = mix3(NIGHT, dayColor, dayF);
  col = mix3(col, SUNSET, duskF * 0.7);
  col = mix3(col, [0, 0, 0], spaceF);

  const caveF = smoothstep(0, DEPTH_FULL_DARK_M, depthBelowM);
  const fogColor: Rgb = [col[0] * (1 - caveF * 0.85), col[1] * (1 - caveF * 0.85), col[2] * (1 - caveF * 0.85)];
  const spaceFogF = smoothstep(FOG_SPACE_START_M, FOG_SPACE_END_M, altitudeM);
  const fogDensity =
    (FOG_SURFACE_DENSITY + (FOG_CAVE_DENSITY - FOG_SURFACE_DENSITY) * caveF) * (1 - spaceFogF);

  const nightF = 1 - smoothstep(-0.15, 0.05, elevation);
  const stars = clampScalar(Math.max(nightF, spaceF), 0, 1);
  return { bg: col, fogColor, fogDensity, stars };
}

export interface SkyUpdate {
  sunDirWorld: Vec3d;
  elevation: number;
  altitudeM: number;
  depthBelowM: number;
  dayColor: Rgb;
}

export class Sky {
  private readonly stars: THREE.Points;
  private readonly starsMat: THREE.PointsMaterial;
  private readonly sunDisc: THREE.Mesh;
  private readonly sunDiscMat: THREE.MeshBasicMaterial;
  private readonly bgColor = new THREE.Color(0x05070f);
  private readonly fog: THREE.FogExp2;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    seed = 1337,
  ) {
    const rng = createRng(`corelight:stars:${seed}`);
    const positions = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i += 1) {
      // Uniform on the sphere (Marsaglia): no pole clumping.
      const u = rng() * 2 - 1;
      const a = rng() * 2 * Math.PI;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      positions[i * 3] = s * Math.cos(a) * STAR_RADIUS;
      positions[i * 3 + 1] = u * STAR_RADIUS;
      positions[i * 3 + 2] = s * Math.sin(a) * STAR_RADIUS;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starsMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.6,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(geometry, this.starsMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -10;
    this.scene.add(this.stars);

    this.sunDiscMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      fog: false,
    });
    this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(SUN_DISC_RADIUS, 32), this.sunDiscMat);
    this.sunDisc.frustumCulled = false;
    this.scene.add(this.sunDisc);

    this.scene.background = this.bgColor;
    this.fog = new THREE.FogExp2(0x05070f, FOG_SURFACE_DENSITY);
    this.scene.fog = this.fog;
  }

  update(u: SkyUpdate): void {
    const state = skyStateFor(u.elevation, u.altitudeM, u.depthBelowM, u.dayColor);
    this.bgColor.setRGB(state.bg[0], state.bg[1], state.bg[2]);
    this.fog.color.setRGB(state.fogColor[0], state.fogColor[1], state.fogColor[2]);
    this.fog.density = state.fogDensity;

    this.starsMat.opacity = state.stars;
    this.stars.position.copy(this.camera.position);

    const [r, g, b] = sunColorForElevation(u.elevation);
    this.sunDiscMat.color.setRGB(r, g, b);
    this.sunDisc.position.set(
      this.camera.position.x + u.sunDirWorld.x * SUN_DISC_DISTANCE,
      this.camera.position.y + u.sunDirWorld.y * SUN_DISC_DISTANCE,
      this.camera.position.z + u.sunDirWorld.z * SUN_DISC_DISTANCE,
    );
    this.sunDisc.lookAt(this.camera.position);
  }

  dispose(): void {
    this.scene.remove(this.stars);
    this.scene.remove(this.sunDisc);
    this.stars.geometry.dispose();
    this.starsMat.dispose();
    this.sunDisc.geometry.dispose();
    this.sunDiscMat.dispose();
    if (this.scene.fog === this.fog) this.scene.fog = null;
    if (this.scene.background === this.bgColor) this.scene.background = null;
  }
}
