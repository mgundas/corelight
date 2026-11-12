// Per-frame camera + environment assembly (M09 split from Game). Picks the
// fly or orbit camera, applies the floating-origin shift, and drives sun,
// sky, atmosphere and fog from sim values. Rendering-side only: no gameplay
// mutation happens here.

import type { Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import type { FreeFlyCamera } from '../player/freeFlyCamera.js';
import type { CameraRig } from '../player/cameraRig.js';
import type { Renderer } from '../render/Renderer.js';
import { maybeShiftOrigin, toLocal } from '../render/floatingOrigin.js';
import type { EntityId } from '../sim/entities.js';
import type { TerrainColliders } from '../sim/physics/terrainColliders.js';
import { upAt } from '../sim/physics/frames.js';
import type { World } from '../sim/world.js';
import { computeEnvironment, findFollowed } from './environment.js';
import { CAMERA_FOCUS_HEIGHT } from '../core/constants.js';

export interface FrameCameraDeps {
  world: World;
  planets: PlanetConfig[];
  renderer: Renderer;
  rig: CameraRig;
  colliders: TerrainColliders;
  flyCamera: FreeFlyCamera;
  playerId: EntityId | null;
  flying: boolean;
  paused: boolean;
  frameDt: number;
  /** Tick interpolation alpha (accumulator / SIM_DT). */
  alpha: number;
}

export interface FrameCameraResult {
  activePos: Vec3d;
  focusWorld: Vec3d;
  depthBelowM: number;
}

export function updateCameraAndEnvironment(deps: FrameCameraDeps): FrameCameraResult {
  const { renderer, world, planets, playerId, flying, alpha } = deps;
  let activePos: Vec3d;
  if (flying) {
    // Frozen while paused: the debug camera must not drift behind the menu.
    if (!deps.paused) deps.flyCamera.update(deps.frameDt);
    activePos = deps.flyCamera.position;
    const local = toLocal(activePos);
    deps.flyCamera.applyToCamera(renderer.camera, local);
  } else {
    const followed = findFollowed(world, planets, playerId);
    if (followed) {
      const renderPos = renderer.playerView.interpolatedWorld(alpha) ?? followed.position;
      const up = upAt(followed.planet, renderPos);
      deps.rig.update(renderPos, up, (origin, dir, maxDist) =>
        deps.colliders.castTerrainRay(origin, dir, planets, maxDist),
        deps.paused ? 0 : deps.frameDt,
      );
      renderer.applyRigCamera({
        x: renderPos.x + up.x * CAMERA_FOCUS_HEIGHT,
        y: renderPos.y + up.y * CAMERA_FOCUS_HEIGHT,
        z: renderPos.z + up.z * CAMERA_FOCUS_HEIGHT,
      }, deps.rig.position, up);
    }
    activePos = deps.rig.position;
  }
  const shift = maybeShiftOrigin(activePos);
  if (shift) renderer.applyOriginShift(shift);

  const lampPlayer = playerId ? world.entities.get(playerId) : undefined;
  const focusWorld = flying
    ? activePos
    : (renderer.playerView.interpolatedWorld(alpha) ?? lampPlayer?.position ?? activePos);
  const env = computeEnvironment(
    world,
    planets,
    activePos,
    focusWorld,
    lampPlayer?.components.player?.headlampOn ?? true,
  );
  renderer.updateEnvironment(env);
  return { activePos, focusWorld, depthBelowM: env.depthBelowM };
}
