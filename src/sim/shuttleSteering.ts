import { SHUTTLE_BRAKE_RATE, SHUTTLE_STEERING_RESPONSE } from '../core/constants.js';
import { add, clampScalar, dot, length, normalize, scale, sub, type Vec3d } from '../core/math.js';
import { moveBasis } from './physics/frames.js';
import { easeUp } from './shuttle.js';

/** Express a world-space aim in a new up frame without steering the nose.
 * At the exact poles yaw is arbitrary, so retain the previous heading. */
export function shuttleHeadingFor(up: Vec3d, direction: Vec3d, fallbackYaw = 0): { yaw: number; pitch: number } {
  const aim = normalize(direction);
  const normal = normalize(up);
  const vertical = clampScalar(dot(aim, normal), -1, 1);
  const flat = sub(aim, scale(normal, vertical));
  const basis = moveBasis(normal, 0, 0);
  return {
    yaw: length(flat) < Number.EPSILON ? fallbackYaw : Math.atan2(-dot(flat, basis.right), dot(flat, basis.forward)),
    pitch: Math.asin(vertical),
  };
}

/** Assist only an active pilot: coast remains inertial without thrust.
 * W turns momentum with the nose; S damps drift, then thrust supplies reverse.
 * Holding Space keeps its independent vertical climb while steering sideways. */
export function steerShuttleVelocity(velocity: Vec3d, forward: Vec3d, up: Vec3d, thrust: number, lifting: boolean, dt: number): Vec3d {
  if (thrust === 0 || dt <= 0) return velocity;
  if (thrust < 0) return scale(velocity, Math.exp(SHUTTLE_BRAKE_RATE * thrust * dt));
  const vertical = lifting ? scale(up, dot(velocity, up)) : { x: 0, y: 0, z: 0 };
  const moving = sub(velocity, vertical);
  const speed = length(moving);
  if (speed === 0) return velocity;
  return add(vertical, scale(easeUp(normalize(moving), forward, SHUTTLE_STEERING_RESPONSE * thrust, dt), speed));
}
