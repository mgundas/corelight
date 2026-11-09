import { ORIGIN_SHIFT_DISTANCE } from '../core/constants.js';
import { events } from '../core/events.js';
import { distance, vec3, type Vec3d } from '../core/math.js';

// Floating origin: three.js positions are float32, so everything is
// rendered relative to `origin`. When the camera drifts too far, the
// origin jumps and all objects shift with it (no visible jump).

let origin: Vec3d = vec3(0, 0, 0);

export function getOrigin(): Vec3d {
  return { ...origin };
}

export function toLocal(worldPos: Vec3d): Vec3d {
  return { x: worldPos.x - origin.x, y: worldPos.y - origin.y, z: worldPos.z - origin.z };
}

export function getShiftDistance(): number {
  return ORIGIN_SHIFT_DISTANCE;
}

/** Snap value to a coarse grid so shifts are stable. */
export function snapToGrid(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

/**
 * If the camera is farther than ORIGIN_SHIFT_DISTANCE from the origin,
 * move the origin to the camera position (rounded to 32 m chunks) and
 * return the shift delta. Otherwise return null.
 */
export function maybeShiftOrigin(cameraWorldPos: Vec3d): Vec3d | null {
  if (distance(cameraWorldPos, origin) < ORIGIN_SHIFT_DISTANCE) return null;
  const next: Vec3d = {
    x: snapToGrid(cameraWorldPos.x, 32),
    y: snapToGrid(cameraWorldPos.y, 32),
    z: snapToGrid(cameraWorldPos.z, 32),
  };
  const delta: Vec3d = {
    x: next.x - origin.x,
    y: next.y - origin.y,
    z: next.z - origin.z,
  };
  origin = next;
  events.emit('originShifted', { origin: { ...origin } });
  return delta;
}

/** Test helper: reset the global origin. */
export function resetOrigin(): void {
  origin = vec3(0, 0, 0);
}
