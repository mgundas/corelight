// M05 lighting rig: one shadow-casting directional sun, a depth-scaled
// hemisphere fill, and a camera-mounted headlamp Spotlight. Pure helpers
// stay unit-testable; the class only wires three.js objects. No gameplay
// logic here: Game feeds it sim values (sun direction, depth, headlamp).

import * as THREE from 'three';
import {
  AMBIENT_DEEP,
  AMBIENT_SURFACE,
  DEPTH_FULL_DARK_M,
  HEADLAMP_ANGLE,
  HEADLAMP_COLOR,
  HEADLAMP_DECAY,
  HEADLAMP_DISTANCE,
  HEADLAMP_INTENSITY,
  HEADLAMP_PENUMBRA,
  SHADOW_FRUSTUM_M,
  SHADOW_MAP_SIZE,
} from '../core/constants.js';
import { cross, dot, normalize, smoothstep, type Vec3d } from '../core/math.js';
import { toLocal } from './floatingOrigin.js';

/** Warm horizon sun lerping to white at noon. */
export function sunColorForElevation(elevation: number): [number, number, number] {
  const t = smoothstep(0, 0.45, elevation);
  return [1, 0.55 + 0.43 * t, 0.28 + 0.66 * t];
}

/** Sun fades out just below the horizon (smooth sunset, no pop). */
export function sunIntensityForElevation(elevation: number): number {
  return 2.2 * smoothstep(-0.1, 0.08, elevation);
}

/** Ambient scale: 1.0 at the surface, smoothly to 0.08 at 25 m down. */
export function ambientForDepth(depthM: number): number {
  const t = smoothstep(0, DEPTH_FULL_DARK_M, depthM);
  return AMBIENT_SURFACE + (AMBIENT_DEEP - AMBIENT_SURFACE) * t;
}

/** Hemisphere base: dim moonlit floor at night, full fill by day. */
export function hemisphereBaseForElevation(elevation: number): number {
  return 0.06 + 0.7 * smoothstep(-0.1, 0.25, elevation);
}

export function shadowTexelSize(): number {
  return SHADOW_FRUSTUM_M / SHADOW_MAP_SIZE;
}

/**
 * Snap a shadow-frustum target onto the texel grid in light space so the
 * cascade stops shimmering while walking. Only the lateral components snap;
 * the range along the sun direction is left alone.
 */
export function snapTargetToTexel(target: Vec3d, sunDir: Vec3d, texel: number): Vec3d {
  const ref = Math.abs(sunDir.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const right = normalize(cross(sunDir, ref));
  const up = cross(right, sunDir);
  const qr = Math.round(dot(target, right) / texel) * texel;
  const qu = Math.round(dot(target, up) / texel) * texel;
  const qd = dot(target, sunDir);
  return {
    x: right.x * qr + up.x * qu + sunDir.x * qd,
    y: right.y * qr + up.y * qu + sunDir.y * qd,
    z: right.z * qr + up.z * qu + sunDir.z * qd,
  };
}

export interface LightingUpdate {
  /** World-space unit sun direction (from the sim). */
  sunDirWorld: Vec3d;
  /** Shadow frustum follows this world point (the player). */
  focusWorld: Vec3d;
  /** Sun elevation above the local horizon at the focus (-1..1). */
  elevation: number;
  /** Depth below the surface at the focus (sim formula, meters). */
  depthBelowM: number;
  headlampOn: boolean;
  /** Hemisphere tint, driven by the sky each frame. */
  skyTint: [number, number, number];
  groundTint: [number, number, number];
}

export class LightingRig {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly headlamp: THREE.SpotLight;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    const half = SHADOW_FRUSTUM_M / 2;
    this.sun.shadow.camera.left = -half;
    this.sun.shadow.camera.right = half;
    this.sun.shadow.camera.top = half;
    this.sun.shadow.camera.bottom = -half;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 600;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.sun.shadow.bias = -0.0001;
    this.sun.shadow.normalBias = 0.05;
    // Repositioned absolutely from world doubles every frame, so origin
    // shifts must not touch it (same pattern as the chunk group).
    this.sun.userData['originManaged'] = true;
    this.sun.target.userData['originManaged'] = true;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd3ff, 0x5a5148, 0.6);
    this.scene.add(this.hemi);

    this.headlamp = new THREE.SpotLight(
      HEADLAMP_COLOR,
      HEADLAMP_INTENSITY,
      HEADLAMP_DISTANCE,
      HEADLAMP_ANGLE,
      HEADLAMP_PENUMBRA,
      HEADLAMP_DECAY,
    );
    // Ride the camera: position and target are camera-local, so the beam
    // always points where the player looks (third-person and fly cam).
    this.camera.add(this.headlamp);
    this.headlamp.position.set(0, 0, 0);
    this.headlamp.target.position.set(0, 0, -10);
    this.camera.add(this.headlamp.target);
    // Children of the camera only render when the camera is in the scene.
    this.scene.add(this.camera);
  }

  update(u: LightingUpdate): void {
    const focus = toLocal(u.focusWorld);
    const focusVec: Vec3d = { x: focus.x, y: focus.y, z: focus.z };
    const snapped = snapTargetToTexel(focusVec, u.sunDirWorld, shadowTexelSize());
    const dist = 250;
    this.sun.position.set(
      snapped.x + u.sunDirWorld.x * dist,
      snapped.y + u.sunDirWorld.y * dist,
      snapped.z + u.sunDirWorld.z * dist,
    );
    this.sun.target.position.set(snapped.x, snapped.y, snapped.z);
    const [r, g, b] = sunColorForElevation(u.elevation);
    this.sun.color.setRGB(r, g, b);
    this.sun.intensity = sunIntensityForElevation(u.elevation);

    this.hemi.color.setRGB(u.skyTint[0], u.skyTint[1], u.skyTint[2]);
    this.hemi.groundColor.setRGB(u.groundTint[0], u.groundTint[1], u.groundTint[2]);
    this.hemi.intensity =
      hemisphereBaseForElevation(u.elevation) * ambientForDepth(u.depthBelowM);

    this.headlamp.visible = u.headlampOn;
  }

  dispose(): void {
    this.scene.remove(this.sun);
    this.scene.remove(this.sun.target);
    this.scene.remove(this.hemi);
    this.camera.remove(this.headlamp);
    this.camera.remove(this.headlamp.target);
    this.headlamp.dispose();
    this.sun.shadow.map?.dispose();
    this.sun.dispose();
    this.hemi.dispose();
  }
}
