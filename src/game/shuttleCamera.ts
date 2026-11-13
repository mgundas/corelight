// Chase camera for the shuttle (M14). The camera sits behind the ship's
// steering heading, above its origin, and pulls in through terrain with the
// same collider ray the astronaut camera uses. It interpolates the attached
// pilot's render position (the pilot entity shares the shuttle transform),
// so the camera glides at display rate even though sim ticks are 30 Hz.

import {
  CAMERA_LOOK_RADIANS_PER_PIXEL,
  SHUTTLE_CHASE_DISTANCE_M,
  SHUTTLE_CHASE_HEIGHT_M,
} from '../core/constants.js';
import { add, clampScalar, normalize, scale, sub, type Vec3d } from '../core/math.js';
import { getSettings } from '../core/settings.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import type { ShuttleComponent } from '../sim/entities.js';
import { moveBasis, upAt } from '../sim/physics/frames.js';
import type { TerrainColliders } from '../sim/physics/terrainColliders.js';

/** Keep the camera off the terrain surface. */
const WALL_MARGIN = 0.6;
const WALL_MIN = 2;
/** Ease render yaw/up toward sim values (frame-rate independent). */
const CAMERA_EASE_RATE = 12;
/** RMB free-look pitch limit (radians). */
const FREE_LOOK_PITCH_LIMIT = 1.1;

export interface ShuttleCameraView {
  position: Vec3d;
  up: Vec3d;
  /** Look-at point (ship center). */
  focus: Vec3d;
  /** Ship origin (shadow/hemisphere focus). */
  anchor: Vec3d;
}

export class ShuttleCamera {
  private yaw: number | null = null;
  private up: Vec3d | null = null;
  /** Camera-only RMB look offset, relative to the ship's steering heading. */
  private freeLookYaw = 0;
  private freeLookPitch = 0;

  /** Forget the previous session/planet basis (new game, exit to menu). */
  reset(): void {
    this.yaw = null;
    this.up = null;
    this.freeLookYaw = 0;
    this.freeLookPitch = 0;
  }

  /** Accumulate one RMB free-look delta (CSS pixels). */
  addFreeLook(dx: number, dy: number): void {
    const settings = getSettings();
    const sensitivity = CAMERA_LOOK_RADIANS_PER_PIXEL * settings.sensitivity;
    this.freeLookYaw -= dx * sensitivity;
    this.freeLookPitch -= dy * sensitivity * (settings.invertY ? -1 : 1);
    this.freeLookPitch = clampScalar(this.freeLookPitch, -FREE_LOOK_PITCH_LIMIT, FREE_LOOK_PITCH_LIMIT);
  }

  /** Follow the ship from `anchorWorld` (the pilot's interpolated origin). */
  update(
    anchorWorld: Vec3d,
    shuttle: ShuttleComponent,
    planets: PlanetConfig[],
    colliders: TerrainColliders,
    frameDt: number,
    planet: PlanetConfig | null,
    freeLookActive: boolean,
  ): ShuttleCameraView {
    const targetUp = planet ? upAt(planet, anchorWorld) : normalize(shuttle.up);
    if (this.yaw === null || this.up === null) {
      this.yaw = shuttle.yaw;
      this.up = { ...targetUp };
    } else {
      const k = 1 - Math.exp(-CAMERA_EASE_RATE * Math.max(0, frameDt));
      const dy = wrapAngle(shuttle.yaw - this.yaw);
      this.yaw += dy * k;
      const blended = normalize(add(scale(this.up, 1 - k), scale(targetUp, k)));
      if (blended.x !== 0 || blended.y !== 0 || blended.z !== 0) this.up = blended;
    }
    if (!freeLookActive) {
      // Release RMB: ease the look offset back behind the ship.
      const k = 1 - Math.exp(-CAMERA_EASE_RATE * Math.max(0, frameDt));
      this.freeLookYaw *= 1 - k;
      this.freeLookPitch *= 1 - k;
    }
    const up = this.up;
    const { forward } = moveBasis(up, this.yaw + this.freeLookYaw, this.freeLookPitch);
    const focus = add(anchorWorld, scale(up, 1.6));
    const desired = add(
      add(anchorWorld, scale(forward, -SHUTTLE_CHASE_DISTANCE_M)),
      scale(up, SHUTTLE_CHASE_HEIGHT_M),
    );
    const toCamera = sub(desired, focus);
    const distance = Math.hypot(toCamera.x, toCamera.y, toCamera.z);
    let actual = distance;
    if (distance > 0.001) {
      const hit = colliders.castTerrainRay(focus, normalize(toCamera), planets, distance + WALL_MARGIN);
      if (hit !== null) actual = Math.max(WALL_MIN, Math.min(distance, hit - WALL_MARGIN));
    }
    const position = add(focus, scale(normalize(toCamera), actual));
    return { position, up, focus, anchor: anchorWorld };
  }
}

/** Shortest signed angle in [-PI, PI]. */
function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let x = (a + Math.PI) % twoPi;
  if (x < 0) x += twoPi;
  return x - Math.PI;
}
