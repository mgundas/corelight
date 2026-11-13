// Cursor aim assembly: exact screen ray with reach measured from the head,
// plus hovered loose item. Pure assembly over injected renderer/sim
// reads, so Game.frame stays short and the math is unit-testable.

import type { Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { HEAD_HEIGHT } from '../player/cameraRig.js';
import { computeAim } from '../player/toolAim.js';
import type { ToolAim } from '../player/terrainTool.js';
import type { EntityId } from '../sim/entities.js';
import { upAt } from '../sim/physics/frames.js';
import type { DensityField } from '../terrain/density.js';
import type { World } from '../sim/world.js';
import { findItemAlongRay, type WorldRay } from './grabPick.js';

export interface CursorAimArgs {
  world: World;
  playerId: EntityId | null;
  followed: { position: Vec3d; planet: PlanetConfig };
  field: DensityField;
  renderPos: Vec3d;
  /** Screen-space ray direction from the cursor (renderer-provided). */
  cursorDir: Vec3d;
  /** Screen-ray origin (camera world position) for exact cursor picking. */
  cursorOrigin: Vec3d;
  castRay: (origin: Vec3d, dir: Vec3d, maxDist: number) => number | null;
  detailed: boolean;
  /** When false (tool equipped), item hovering is skipped. */
  cursorMode: boolean;
}

export interface CursorAimResult {
  aim: ToolAim;
  ray: WorldRay;
  hoverItemId: EntityId | null;
}

export function computeCursorAim(args: CursorAimArgs): CursorAimResult {
  const up = upAt(args.followed.planet, args.renderPos);
  const head: Vec3d = {
    x: args.renderPos.x + up.x * HEAD_HEIGHT,
    y: args.renderPos.y + up.y * HEAD_HEIGHT,
    z: args.renderPos.z + up.z * HEAD_HEIGHT,
  };
  const ray: WorldRay = { origin: { ...args.cursorOrigin }, dir: { ...args.cursorDir } };
  const aim = computeAim({
    origin: ray.origin,
    reachOrigin: head,
    viewDir: ray.dir,
    planet: args.followed.planet,
    field: args.field,
    castRay: args.castRay,
    detailed: args.detailed,
  });
  const hoverItemId =
    args.cursorMode && args.playerId ? findItemAlongRay(args.world, args.playerId, ray) : null;
  return { aim, ray, hoverItemId };
}
