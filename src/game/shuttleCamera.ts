// Chase camera for the shuttle (M14). The camera sits behind the ship's
// steering heading, above its origin, and pulls in through terrain with the
// same collider ray the astronaut camera uses. It interpolates the attached
// pilot's render position (the pilot entity shares the shuttle transform),
// so the camera glides at display rate even though sim ticks are 30 Hz.

import {
  CAMERA_LOOK_RADIANS_PER_PIXEL,
  SHUTTLE_CHASE_DISTANCE_M,
  SHUTTLE_CHASE_HEIGHT_M,
  SHUTTLE_CAMERA_MIN_M,
} from '../core/constants.js';
import { add, clampScalar, cross, normalize, scale, sub, type Vec3d } from '../core/math.js';
import { getSettings } from '../core/settings.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import type { ShuttleComponent } from '../sim/entities.js';
import { moveBasis } from '../sim/physics/frames.js';
import { easeUp, shuttleForward } from '../sim/shuttle.js';
import { shuttleHeadingFor } from '../sim/shuttleSteering.js';
import type { TerrainColliders } from '../sim/physics/terrainColliders.js';

/** Keep the camera off the terrain surface. */
const WALL_MARGIN = 0.6;
const WALL_MIN = SHUTTLE_CAMERA_MIN_M;
/** Ease world heading/up toward sim values (frame-rate independent). */
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
  private forward: Vec3d | null = null;
  private up: Vec3d | null = null;
  /** Camera-only RMB look offset, relative to the ship's steering heading. */
  private freeLookYaw = 0;
  private freeLookPitch = 0;

  /** Forget the previous session/planet basis (new game, exit to menu). */
  reset(): void {
    this.forward = null;
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
    colliders: Pick<TerrainColliders, 'castTerrainRay'>,
    frameDt: number,
    _planet: PlanetConfig | null,
    freeLookActive: boolean,
  ): ShuttleCameraView {
    const targetUp = normalize(shuttle.up);
    const targetForward = shuttleForward(shuttle.up, shuttle.yaw, shuttle.pitch);
    if (this.forward === null || this.up === null) {
      this.forward = targetForward;
      this.up = { ...targetUp };
    } else {
      // Smooth world heading, not angles belonging to different up frames.
      this.forward = easeUp(this.forward, targetForward, CAMERA_EASE_RATE, frameDt);
      this.up = easeUp(this.up, targetUp, CAMERA_EASE_RATE, frameDt);
    }
    if (!freeLookActive) {
      // Release RMB: ease the look offset back behind the ship.
      const k = 1 - Math.exp(-CAMERA_EASE_RATE * Math.max(0, frameDt));
      this.freeLookYaw *= 1 - k;
      this.freeLookPitch *= 1 - k;
    }
    const up = this.up;
    const heading = shuttleHeadingFor(up, this.forward, shuttle.yaw);
    const { forward, right } = moveBasis(up, heading.yaw + this.freeLookYaw, heading.pitch + this.freeLookPitch);
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
      if (hit !== null) actual = Math.max(Math.min(WALL_MIN, hit / 2), Math.min(distance, hit - WALL_MARGIN));
    }
    const position = add(focus, scale(normalize(toCamera), actual));
    // Looking straight up/down must not pass a parallel camera-up vector
    // to lookAt, which otherwise chooses an arbitrary roll at the pole.
    return { position, up: normalize(cross(right, forward)), focus, anchor: anchorWorld };
  }
}
