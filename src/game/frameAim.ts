// Per-frame aim assembly (cursor mode + orbit fallback). Split out of Game
// to keep Game.ts under the 400-line hard rule: pure reads of World/render
// state, no mutation. Strokes bake the result into Actions.

import type { Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import type { CameraRig } from '../player/cameraRig.js';
import type { FreeFlyCamera } from '../player/freeFlyCamera.js';
import type { ToolAim } from '../player/terrainTool.js';
import type { Renderer } from '../render/Renderer.js';
import type { TerrainColliders } from '../sim/physics/terrainColliders.js';
import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';
import type { DensityField } from '../terrain/density.js';
import { computeToolAim as buildToolAim } from './aimWiring.js';
import { computeCursorAim } from './cursorAim.js';
import { findFollowed } from './environment.js';
import type { WorldRay } from './grabPick.js';
import { findPackableAlongRay } from './packPick.js';

export interface FrameAimArgs {
  world: World;
  planets: PlanetConfig[];
  playerId: EntityId | null;
  renderer: Renderer;
  colliders: TerrainColliders;
  toolFields: Map<string, DensityField>;
  flyCamera: FreeFlyCamera;
  rig: CameraRig;
  alpha: number;
  detailed: boolean;
  toolActive: boolean;
  orbiting: boolean;
  cursorX: number;
  cursorY: number;
}

export interface FrameAim {
  aim: ToolAim;
  ray: WorldRay | null;
  hoverItemId: EntityId | null;
  hoverPackId: EntityId | null;
}

export const NO_FRAME_AIM: FrameAim = {
  aim: { hit: null, normal: null, planet: null },
  ray: null,
  hoverItemId: null,
  hoverPackId: null,
};

export function computeFrameAim(args: FrameAimArgs): FrameAim {
  const followed = findFollowed(args.world, args.planets, args.playerId);
  const renderPos =
    args.flyCamera.enabled || !followed
      ? null
      : (args.renderer.playerView.interpolatedWorld(args.alpha) ?? followed.position);
  const field = followed ? args.toolFields.get(followed.planet.id) : undefined;
  if (!followed || !field || !renderPos) return { ...NO_FRAME_AIM };
  const castRay = (origin: Vec3d, dir: Vec3d, maxDist: number) =>
    args.colliders.castTerrainRay(origin, dir, args.planets, maxDist);
  if (args.orbiting) {
    return {
      aim: buildToolAim({
        followed,
        field,
        renderPos,
        rigPosition: args.rig.position,
        castRay,
        detailed: args.detailed,
      }),
      ray: null,
      hoverItemId: null,
      hoverPackId: null,
    };
  }
  const screen = args.renderer.screenRay(args.cursorX, args.cursorY);
  const result = computeCursorAim({
    world: args.world,
    playerId: args.playerId,
    followed,
    field,
    renderPos,
    cursorDir: screen.dir,
    cursorOrigin: screen.origin,
    castRay,
    detailed: args.detailed,
    cursorMode: !args.toolActive,
  });
  const hoverPackId =
    !args.toolActive && args.playerId
      ? findPackableAlongRay(args.world, args.playerId, result.ray)
      : null;
  return {
    aim: result.aim,
    ray: result.ray,
    hoverItemId: result.hoverItemId,
    hoverPackId,
  };
}
