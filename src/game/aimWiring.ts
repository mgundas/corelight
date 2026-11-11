// Terrain-tool aim wiring (M05 split: keeps Game.ts under 400 lines).
// Pure assembly over Game-owned state: builds the per-frame ToolAim from
// the orbit camera through the crosshair. Strokes bake it into Actions.

import type { Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { HEAD_HEIGHT } from '../player/cameraRig.js';
import { aimFromOrbitCamera, computeAim, NO_AIM } from '../player/toolAim.js';
import type { ToolAim } from '../player/terrainTool.js';
import { upAt } from '../sim/physics/frames.js';
import type { DensityField } from '../terrain/density.js';

export interface AimArgs {
  /** Null in fly mode or with no player (no brush then). */
  followed: { position: Vec3d; planet: PlanetConfig } | null;
  /** Edited-density field for the followed planet (undefined until loaded). */
  field: DensityField | undefined;
  /** Interpolated astronaut position, or null in fly mode. */
  renderPos: Vec3d | null;
  /** Orbit camera world position (sets the view direction). */
  rigPosition: Vec3d;
  /** World-space terrain ray (collider-backed, cheap on idle frames). */
  castRay: (origin: Vec3d, dir: Vec3d, maxDist: number) => number | null;
  /** True while a brush button is held (march + normal, else preview only). */
  detailed: boolean;
}

export function computeToolAim(args: AimArgs): ToolAim {
  const { followed, field, renderPos } = args;
  if (!followed || !field || !renderPos) return { ...NO_AIM };
  const up = upAt(followed.planet, renderPos);
  const head: Vec3d = {
    x: renderPos.x + up.x * HEAD_HEIGHT,
    y: renderPos.y + up.y * HEAD_HEIGHT,
    z: renderPos.z + up.z * HEAD_HEIGHT,
  };
  const { origin, dir: viewDir } = aimFromOrbitCamera(head, args.rigPosition);
  return computeAim({
    origin,
    viewDir,
    planet: followed.planet,
    field,
    castRay: args.castRay,
    detailed: args.detailed,
  });
}
