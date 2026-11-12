// Frame-rate tool aiming (M04): orbit-camera raycast against the Rapier
// terrain colliders, falling back to a density march while edited colliders
// rebuild. Pure: all world access arrives via parameters, so aiming is
// unit-testable and the sim stays deterministic (strokes bake the aim into
// Actions, which carry the range/hardness checks).

import { TOOL_RANGE_M } from '../core/constants.js';
import { normalize, sub, type Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { upAt } from '../sim/physics/frames.js';
import type { DensityField } from '../terrain/density.js';
import type { ToolAim } from './terrainTool.js';

export interface AimInput {
  /**
   * Ray origin: the astronaut's head (player pos + up x HEAD_HEIGHT), not
   * the camera. The orbit camera sits 2–8 m behind the player; measuring
   * the 6 m tool budget from the camera would spend the reach on the zoom
   * distance and make the ground at one's feet unreachable.
   */
  origin: Vec3d;
  /** View direction: camera forward through the crosshair. */
  viewDir: Vec3d;
  planet: PlanetConfig;
  /** Edited-density field for the fallback march + normals. */
  field: DensityField;
  /** Exact-collider ray distance (null = clear). */
  castRay: (origin: Vec3d, dir: Vec3d, maxDist: number) => number | null;
  /**
   * Full aim while a brush button is held (fallback march + surface
   * normal). Idle frames keep only the cheap collider ray for the
   * preview, sparing the main thread the density evals.
   */
  detailed: boolean;
}

/** No aim (flying, no player, zero direction): the tool stays quiet. */
export const NO_AIM: ToolAim = { hit: null, normal: null, planet: null };

/**
 * Ray for the orbit camera: starts at the head and continues along the
 * camera's view direction (head - cameraPos), so the crosshair, the
 * preview sphere, and the edit all agree. Pure, for tests and Game.
 */
export function aimFromOrbitCamera(headPos: Vec3d, cameraPos: Vec3d): { origin: Vec3d; dir: Vec3d } {
  return { origin: { ...headPos }, dir: normalize(sub(headPos, cameraPos)) };
}

export function computeAim(input: AimInput): ToolAim {
  const { origin, viewDir, planet, field } = input;
  if (viewDir.x === 0 && viewDir.y === 0 && viewDir.z === 0) return { ...NO_AIM };
  // The view ray is useful even when the terrain ray misses (platforms have
  // no colliders, so cable snapping must project onto them directly).
  const ray = { origin: { ...origin }, dir: { ...viewDir } };
  const toi = input.castRay(origin, viewDir, TOOL_RANGE_M);
  if (toi !== null && toi <= TOOL_RANGE_M) {
    const hit: Vec3d = {
      x: origin.x + viewDir.x * toi,
      y: origin.y + viewDir.y * toi,
      z: origin.z + viewDir.z * toi,
    };
    return { hit, normal: input.detailed ? surfaceNormal(field, planet, hit) : null, planet, ray };
  }
  if (!input.detailed) return { ...NO_AIM, ray, planet };
  // Fallback march along the ray (quarter-meter steps). When the origin
  // itself starts inside rock, report t = 0 so the brush (and preview)
  // keep working instead of vanishing.
  const at = (t: number): Vec3d => ({
    x: origin.x + viewDir.x * t - planet.center.x,
    y: origin.y + viewDir.y * t - planet.center.y,
    z: origin.z + viewDir.z * t - planet.center.z,
  });
  const start = at(0);
  let prevT = 0;
  let prevD = field.density(start.x, start.y, start.z);
  if (prevD >= 0) {
    return { hit: { ...origin }, normal: surfaceNormal(field, planet, origin), planet, ray };
  }
  for (let t = 0.25; t <= TOOL_RANGE_M; t += 0.25) {
    const p = at(t);
    const d = field.density(p.x, p.y, p.z);
    if (d >= 0) {
      const f = prevD / (prevD - d);
      const ht = prevT + f * (t - prevT);
      const hit: Vec3d = {
        x: origin.x + viewDir.x * ht,
        y: origin.y + viewDir.y * ht,
        z: origin.z + viewDir.z * ht,
      };
      return { hit, normal: surfaceNormal(field, planet, hit), planet, ray };
    }
    prevT = t;
    prevD = d;
  }
  return { ...NO_AIM, ray, planet };
}

/** Outward surface normal at a world-space hit (air side of the density). */
export function surfaceNormal(field: DensityField, planet: PlanetConfig, hit: Vec3d): Vec3d {
  const local = sub(hit, planet.center);
  const eps = 0.5;
  const grad: Vec3d = {
    x: field.density(local.x + eps, local.y, local.z) - field.density(local.x - eps, local.y, local.z),
    y: field.density(local.x, local.y + eps, local.z) - field.density(local.x, local.y - eps, local.z),
    z:
      field.density(local.x, local.y, local.z + eps) -
      field.density(local.x, local.y, local.z - eps),
  };
  const n = normalize({ x: -grad.x, y: -grad.y, z: -grad.z });
  if (n.x === 0 && n.y === 0 && n.z === 0) return upAt(planet, hit);
  return n;
}
