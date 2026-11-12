// Third-person orbit camera (M03): follows the astronaut at a zoomable
// distance, aligned to the local (spherical) up, pulled in by terrain so it
// never clips through cave walls. F3 toggles back to the free-fly camera.

import type { Vec3d } from '../core/math.js';
import { moveBasis } from '../sim/physics/frames.js';
import { CAMERA_LOOK_RADIANS_PER_PIXEL, CAMERA_RECOVERY_RATE } from '../core/constants.js';
import { getSettings } from '../core/settings.js';

export const CAM_DISTANCE_DEFAULT = 4;
export const CAM_DISTANCE_MIN = 2;
export const CAM_DISTANCE_MAX = 8;
/** Head height above the capsule center. */
export const HEAD_HEIGHT = 1.5;
/** Keep this far from the hit surface. */
const WALL_MARGIN = 0.3;
/** Closest the camera gets to the head when walled in. */
const WALL_MIN = 0.6;

export class CameraRig {
  yaw = 0;
  pitch = -0.15;
  distance = CAM_DISTANCE_DEFAULT;
  /** Current camera world position (for streaming + floating origin). */
  position: Vec3d = { x: 0, y: 0, z: 0 };
  private actualDistance: number | null = null;

  addLook(dx: number, dy: number): void {
    const settings = getSettings();
    const sensitivity = CAMERA_LOOK_RADIANS_PER_PIXEL * settings.sensitivity;
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity * (settings.invertY ? -1 : 1);
    const limit = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  }

  zoom(deltaY: number): void {
    if (deltaY === 0) return;
    const factor = deltaY > 0 ? 1.15 : 1 / 1.15;
    this.distance = Math.min(CAM_DISTANCE_MAX, Math.max(CAM_DISTANCE_MIN, this.distance * factor));
  }

  /**
   * Place the camera behind the player. `raycast` answers the world-space
   * distance to terrain along a ray (null = clear) so walls pull the camera
   * in instead of clipping.
   */
  update(
    playerPos: Vec3d,
    up: Vec3d,
    raycast: (origin: Vec3d, dir: Vec3d, maxDist: number) => number | null,
    frameDt?: number,
  ): void {
    const head: Vec3d = {
      x: playerPos.x + up.x * HEAD_HEIGHT,
      y: playerPos.y + up.y * HEAD_HEIGHT,
      z: playerPos.z + up.z * HEAD_HEIGHT,
    };
    const { forward } = moveBasis(up, this.yaw, this.pitch);
    // Camera looks along the aim direction: behind the head, above by pitch.
    const back: Vec3d = { x: -forward.x, y: -forward.y, z: -forward.z };
    let dist = this.distance;
    const hit = raycast(head, back, this.distance + WALL_MARGIN);
    if (hit !== null) {
      dist = Math.max(WALL_MIN, Math.min(dist, hit - WALL_MARGIN));
    }
    // Pull inward immediately to avoid clipping. Ease only the return to
    // full distance, so walking past an edge does not kick the camera out.
    if (this.actualDistance !== null && dist > this.actualDistance && frameDt !== undefined && getSettings().smoothCamera) {
      dist = this.actualDistance + (dist - this.actualDistance) * (1 - Math.exp(-CAMERA_RECOVERY_RATE * Math.max(0, frameDt)));
    }
    this.actualDistance = dist;
    this.position = {
      x: head.x + back.x * dist,
      y: head.y + back.y * dist,
      z: head.z + back.z * dist,
    };
  }
}
