// Shuttle flight helpers (M14). Pure functions only: no three.js, no World
// mutation. The system and actions share these so the HUD, validation and
// integration cannot disagree about speed, altitude or "landed".

import {
  SHUTTLE_BOOST_MULT,
  SHUTTLE_EXIT_SPEED_MPS,
  SHUTTLE_FUEL_MAX,
  SHUTTLE_MAX_SPEED_SURFACE,
  SHUTTLE_MAX_SPEED_SPACE,
  SHUTTLE_PITCH_LIMIT,
  SHUTTLE_SPACE_CRUISE_SPEED,
  SHUTTLE_SPEED_RAMP_M,
} from '../core/constants.js';
import {
  add,
  clampScalar,
  length,
  normalize,
  quatFromAxisAngle,
  quatMultiply,
  quatFromTo,
  rotateVector,
  smoothstep,
  sub,
  type Quat,
  type Vec3d,
} from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import type { Entity, EntityId, ShuttleComponent } from './entities.js';
import { moveBasis, orientationForUpYaw } from './physics/frames.js';

/** Clamp a stored fuel count into the legal range. */
export function shuttleFuel(shuttle: ShuttleComponent): number {
  if (!Number.isFinite(shuttle.fuel)) return 0;
  return clampScalar(shuttle.fuel, 0, SHUTTLE_FUEL_MAX);
}

/** True when a player is attached to this shuttle. */
export function isPiloted(shuttle: ShuttleComponent | undefined): boolean {
  return shuttle !== undefined && shuttle.pilotId !== null;
}

/** World-frame speed in m/s. */
export function shuttleSpeed(shuttle: ShuttleComponent): number {
  return length(shuttle.velocity);
}

/** Height above the nominal surface of a planet (m, never negative). */
export function altitudeAbove(planet: PlanetConfig, worldPos: Vec3d): number {
  return Math.max(0, length(sub(worldPos, planet.center)) - planet.radius);
}

/**
 * Speed cap for the current frame. Near a surface it is 120 m/s and grows
 * with altitude to the 600 m/s space cap; in deep space the cruise cap is
 * 300 m/s and Shift unlocks 600 m/s (PROJECT.md M14: 30-60 s between planets).
 */
export function shuttleMaxSpeed(
  planet: PlanetConfig | null,
  worldPos: Vec3d,
  boost: boolean,
): number {
  if (!planet) return boost ? SHUTTLE_MAX_SPEED_SPACE : SHUTTLE_SPACE_CRUISE_SPEED;
  const altitude = altitudeAbove(planet, worldPos);
  const t = smoothstep(0, SHUTTLE_SPEED_RAMP_M, altitude);
  const base = SHUTTLE_MAX_SPEED_SURFACE + (SHUTTLE_MAX_SPEED_SPACE - SHUTTLE_MAX_SPEED_SURFACE) * t;
  return boost ? Math.min(SHUTTLE_MAX_SPEED_SPACE, base * SHUTTLE_BOOST_MULT) : base;
}

/** Exit rule from PROJECT.md: only when landed and under 1 m/s. */
export function isLanded(shuttle: ShuttleComponent): boolean {
  return !shuttle.airborne && shuttleSpeed(shuttle) < SHUTTLE_EXIT_SPEED_MPS;
}

/** The shuttle a player is attached to, if the link is still valid. */
export function pilotedShuttle(world: { entities: Map<EntityId, Entity> }, playerId: EntityId): Entity | undefined {
  const player = world.entities.get(playerId);
  const id = player?.components.player?.pilotingShuttleId;
  if (!id) return undefined;
  const shuttle = world.entities.get(id);
  if (!shuttle || shuttle.kind !== 'shuttle' || !shuttle.components.shuttle) return undefined;
  if (shuttle.components.shuttle.pilotId !== playerId) return undefined;
  return shuttle;
}

/** Nose direction (includes pitch) in the current up basis. */
export function shuttleForward(up: Vec3d, yaw: number, pitch: number): Vec3d {
  return moveBasis(up, yaw, pitch).forward;
}

/** Shortest signed angle in [-PI, PI]. */
export function shortestAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let x = (angle + Math.PI) % twoPi;
  if (x < 0) x += twoPi;
  return x - Math.PI;
}

/**
 * Body orientation: local +Y is the ship's up and local +Z its nose. Yaw
 * rotates around the stored up; positive pitch raises the nose.
 */
export function shuttleOrientation(up: Vec3d, yaw: number, pitch: number): Quat {
  const yawOnly = orientationForUpYaw(up, yaw);
  const tilt = quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -clampScalar(pitch, -SHUTTLE_PITCH_LIMIT, SHUTTLE_PITCH_LIMIT));
  return quatMultiply(yawOnly, tilt);
}

/**
 * Ease one up vector toward another via its shortest-arc rotation:
 * on entry the ship gently rotates until its "down" points at the planet
 * instead of snapping a whole hemisphere at the boundary.
 */
export function easeUp(current: Vec3d, target: Vec3d, rate: number, dt: number): Vec3d {
  const from = normalize(current);
  const to = normalize(target);
  if (from.x === 0 && from.y === 0 && from.z === 0) return to;
  const t = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt));
  // Interpolating vectors cannot leave an exactly opposite hemisphere.
  // Interpolate the shortest-arc rotation instead, including its stable
  // perpendicular axis for antipodal arrivals.
  const rotation = quatFromTo(from, to);
  const blended = { x: rotation.x * t, y: rotation.y * t, z: rotation.z * t, w: 1 - t + rotation.w * t };
  const magnitude = Math.hypot(blended.x, blended.y, blended.z, blended.w);
  return normalize(rotateVector(from, {
    x: blended.x / magnitude, y: blended.y / magnitude, z: blended.z / magnitude, w: blended.w / magnitude,
  }));
}

/** Integrate the velocity by one arcade step (gravity + thrust + lift). */
export function integrateShuttleVelocity(
  velocity: Vec3d,
  gravity: Vec3d,
  forward: Vec3d,
  up: Vec3d,
  thrust: number,
  lift: number,
  dt: number,
): Vec3d {
  return add(
    velocity,
    add(
      add(
        { x: gravity.x * dt, y: gravity.y * dt, z: gravity.z * dt },
        { x: forward.x * thrust * dt, y: forward.y * thrust * dt, z: forward.z * thrust * dt },
      ),
      { x: up.x * lift * dt, y: up.y * lift * dt, z: up.z * lift * dt },
    ),
  );
}

/** Clamp a velocity vector to a speed cap (direction preserved). */
export function clampSpeed(velocity: Vec3d, maxSpeed: number): Vec3d {
  const speed = length(velocity);
  if (!Number.isFinite(speed) || speed <= maxSpeed || speed === 0) return velocity;
  const scaleFactor = maxSpeed / speed;
  return { x: velocity.x * scaleFactor, y: velocity.y * scaleFactor, z: velocity.z * scaleFactor };
}
