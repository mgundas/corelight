// Shuttle flight system (M14). Arcade model per the milestone prompt:
// inside an SOI gravity applies; W/S thrust, A/D yaw, mouse pitch/yaw (all
// through shuttleInput Actions), Space lift and Shift boost. In space there
// is no gravity and the speed cap grows to the 600 m/s boosted cruise.
//
// Collision is handled by a real Rapier dynamic body with a compound
// collider (physics/shuttleBody.ts). The body lives in the planet-local
// frame and is resolved by the physics system's single central step; this
// system reads the contact-resolved transform, applies one arcade step and
// writes the next desired state. In deep space there is no terrain, so the
// position integrates directly in world doubles.
//
// Landing assist: under 40 m AGL the descent and horizontal speed are
// clamped and the ship levels out. Touching down below 6 m/s rests on its
// legs; a faster impact bounces (no damage in v1).

import type * as RAPIER from '@dimforge/rapier3d-compat';
import {
  SHUTTLE_ASSIST_DESCENT_MPS,
  SHUTTLE_ASSIST_SPEED_MPS,
  SHUTTLE_AUTO_ORIENT_RATE,
  SHUTTLE_BOUNCE_DAMP,
  SHUTTLE_GROUND_CLEARANCE_M,
  SHUTTLE_LANDING_ASSIST_M,
  SHUTTLE_LAUNCH_HOLD_S,
  SHUTTLE_LAUNCH_SPEED,
  SHUTTLE_LIFT_ACCEL,
  SHUTTLE_PITCH_LIMIT,
  SHUTTLE_SAFE_TOUCHDOWN_MPS,
  SHUTTLE_TERRAIN_PENDING_ALTITUDE_M,
  SHUTTLE_THRUST_ACCEL,
  SHUTTLE_YAW_RATE,
  SHUTTLE_FUEL_MAX,
  SHUTTLE_APPROACH_BRAKE_RATE,
  SHUTTLE_MAX_SPEED_SPACE,
  SHUTTLE_MAX_SPEED_SURFACE,
} from '../../core/constants.js';
import { add, clampScalar, dot, scale, type Vec3d } from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import type { Entity, EntityId } from '../entities.js';
import { upAt } from '../physics/frames.js';
import { gravityAt, sphereOfInfluence } from '../physics/gravity.js';
import { ShuttleBody } from '../physics/shuttleBody.js';
import {
  altitudeAbove,
  clampSpeed,
  easeUp,
  integrateShuttleVelocity,
  shuttleForward,
  shuttleMaxSpeed,
  shuttleOrientation,
  shuttleSpeed,
  shuttleFuel,
  shortestAngle,
} from '../shuttle.js';
import { attachPilotToShuttle } from '../shuttleActions.js';
import type { World } from '../world.js';

export interface ShuttleSystemOptions {
  planets: PlanetConfig[];
  /** Terrain ray probe (the collider ring); null hit = nothing below. */
  probe: {
    castTerrainRay(origin: Vec3d, dir: Vec3d, planets: PlanetConfig[], maxDist: number): number | null;
  };
  worldFor?: (planetId: string) => RAPIER.World;
}

const ZERO: Vec3d = { x: 0, y: 0, z: 0 };

/**
 * Ease the ship's up toward the planet radial and level the nose while the
 * assist is active. Returns the new pitch.
 */
export function assistPitch(pitch: number, dt: number): number {
  return pitch * Math.exp(-6 * Math.max(0, dt));
}

export function makeShuttleSystem(opts: ShuttleSystemOptions): (world: World, dt: number) => void {
  const bodies = new Map<EntityId, ShuttleBody>();

  return (world: World, dt: number): void => {
    for (const [id, body] of [...bodies]) {
      if (!world.entities.has(id)) {
        body.dispose();
        bodies.delete(id);
      }
    }
    for (const entity of world.entities.values()) {
      if (entity.kind !== 'shuttle' || !entity.components.shuttle) continue;
      let body = bodies.get(entity.id);
      if (!body) {
        // Restoring a piloted save starts a fresh input device/camera frame.
        delete entity.components.shuttle.lastLookYaw;
        delete entity.components.shuttle.lastLookPitch;
        body = new ShuttleBody(opts.worldFor);
        bodies.set(entity.id, body);
      }
      updateShuttle(world, opts, entity, body, dt);
    }
  };
}

function updateShuttle(
  world: World,
  opts: ShuttleSystemOptions,
  entity: Entity,
  body: ShuttleBody,
  dt: number,
): void {
  const shuttle = entity.components.shuttle;
  if (!shuttle) return;
  // A stale pilot link (load with the shuttle gone, or a hand-edited save)
  // must not leave a player frozen forever.
  if (shuttle.pilotId) {
    const pilot = world.entities.get(shuttle.pilotId);
    if (!pilot || pilot.components.player?.pilotingShuttleId !== entity.id) shuttle.pilotId = null;
  }

  // 1) Contact-resolved state from the previous central step (planet frame).
  const boundPlanet = body.boundPlanetId
    ? opts.planets.find((p) => p.id === body.boundPlanetId)
    : undefined;
  if (boundPlanet) {
    const resolved = body.read(boundPlanet);
    if (resolved) {
      entity.position = resolved.position;
      entity.rotation = resolved.rotation;
      shuttle.velocity = resolved.velocity;
    }
  }

  // 2) SOI/frame handoff (M13 pattern: planetId is a relabel, positions stay
  // world doubles; the body rebinds in the new local frame this tick).
  const sample = gravityAt(opts.planets, entity.position);
  const planet = sample.planet;
  entity.planetId = planet?.id ?? null;

  // 3) Auto-orient. On the ground the ship sits exactly on radial up; in
  // flight the basis eases so entering an SOI gently rolls "down" toward the
  // planet instead of snapping a hemisphere.
  const radialUp = planet ? upAt(planet, entity.position) : shuttle.up;
  shuttle.up = !shuttle.airborne && planet
    ? radialUp
    : easeUp(shuttle.up, radialUp, SHUTTLE_AUTO_ORIENT_RATE, dt);

  // 4) Consume one tick of pilot input (all of it arrived as Actions).
  const input = shuttle.input;
  shuttle.input = null;
  const piloted = shuttle.pilotId !== null;
  if (piloted && input) {
    // Mouse look is absolute; A/D is a continuous rate. Accumulate the look
    // delta and the yaw rate so holding A/D actually turns instead of
    // nudging once and then holding the same absolute heading.
    const lastLook = shuttle.lastLookYaw ?? input.lookYaw;
    const lookDelta = shortestAngle(input.lookYaw - lastLook);
    // Positive yaw turns toward local east in the shared basis; a positive
    // yawRate means "steer right" (D), which is the opposite sign.
    shuttle.yaw = shortestAngle(shuttle.yaw + lookDelta - input.yawRate * SHUTTLE_YAW_RATE * dt);
    shuttle.lastLookYaw = input.lookYaw;
    const lastPitch = shuttle.lastLookPitch ?? input.lookPitch;
    shuttle.pitch = clampScalar(shuttle.pitch + input.lookPitch - lastPitch, -SHUTTLE_PITCH_LIMIT, SHUTTLE_PITCH_LIMIT);
    shuttle.lastLookPitch = input.lookPitch;
  } else if (piloted) {
    // A missing input tick (pause/UI) means "no stick", never a stuck one.
    shuttle.pitch = clampScalar(shuttle.pitch, -SHUTTLE_PITCH_LIMIT, SHUTTLE_PITCH_LIMIT);
  }
  const thrust = piloted && input ? input.thrust : 0;
  const lifting = piloted && input?.lift === true;
  const boosting = piloted && input?.boost === true;

  // 5) Bind the dynamic body to the current frame.
  if (planet) body.ensureBound(planet, entity.position, entity.rotation, shuttle.velocity);
  else body.dispose();

  // 6) Parked: legs on the ground, launch charge, no gravity.
  if (!shuttle.airborne) {
    shuttle.velocity = { ...ZERO };
    if (piloted && lifting && shuttleFuel(shuttle) >= SHUTTLE_FUEL_MAX) {
      shuttle.launchChargeS += dt;
      if (shuttle.launchChargeS >= SHUTTLE_LAUNCH_HOLD_S) {
        // Launch consumes both cells and starts a stable climb.
        shuttle.fuel = 0;
        shuttle.launchChargeS = 0;
        shuttle.airborne = true;
        shuttle.velocity = scale(shuttle.up, SHUTTLE_LAUNCH_SPEED);
      }
    } else {
      shuttle.launchChargeS = 0;
    }
    entity.rotation = shuttleOrientation(shuttle.up, shuttle.yaw, shuttle.pitch);
    if (planet) body.write(planet, entity.position, entity.rotation, shuttle.velocity);
    syncPilot(world, entity, shuttle.pilotId);
    return;
  }

  // 7) Airborne arcade step: thrust + lift + SOI gravity, then the speed cap.
  const forward = shuttleForward(shuttle.up, shuttle.yaw, shuttle.pitch);
  const liftAccel = lifting ? SHUTTLE_LIFT_ACCEL : 0;
  shuttle.velocity = integrateShuttleVelocity(
    shuttle.velocity,
    planet ? sample.vector : ZERO,
    forward,
    shuttle.up,
    thrust * SHUTTLE_THRUST_ACCEL,
    liftAccel,
    dt,
  );
  shuttle.velocity = clampSpeed(shuttle.velocity, shuttleMaxSpeed(planet, entity.position, boosting));

  // 8) Landing assist + touchdown/bounce. AGL comes from the same terrain
  // colliders the player stands on; a null hit means open air.
  if (planet) {
    // Contact/approach must use the actual planet radial, not the gradually
    // rotating visual basis carried across the interplanetary handoff.
    const landingUp = radialUp;
    const descender = -dot(shuttle.velocity, landingUp);
    const ground = opts.probe.castTerrainRay(
      entity.position,
      scale(landingUp, -1),
      opts.planets,
      SHUTTLE_LANDING_ASSIST_M + 25,
    );
    const altitude = altitudeAbove(planet, entity.position);
    if (descender > 0 && !lifting && shuttleSpeed(shuttle) > SHUTTLE_MAX_SPEED_SURFACE &&
        (ground === null || ground > SHUTTLE_LANDING_ASSIST_M)) {
      // Brake progressively throughout arrival, rather than carrying cruise
      // momentum into a collider ring only 48 metres wide.
      const approach = Math.min(1, altitude / (sphereOfInfluence(planet) - planet.radius));
      const cap = Math.max(SHUTTLE_ASSIST_SPEED_MPS, SHUTTLE_MAX_SPEED_SPACE * approach * approach);
      shuttle.velocity = clampSpeed(shuttle.velocity, cap);
    }
    // No ground hit while low means the collider ring has not caught up
    // (or the ship is over a deep hole). Do not let a fast ship outrun the
    // worker stream into a hill: fall back to the assist speed.
    if (ground === null && altitude < SHUTTLE_TERRAIN_PENDING_ALTITUDE_M) {
      shuttle.velocity = clampSpeed(shuttle.velocity, SHUTTLE_ASSIST_SPEED_MPS);
    }
    const assist = ground !== null
      ? ground < SHUTTLE_LANDING_ASSIST_M
      : altitude < SHUTTLE_LANDING_ASSIST_M;
    if (assist) {
      // Level out and cap the approach.
      shuttle.pitch = assistPitch(shuttle.pitch, dt);
      const currentDescent = -dot(shuttle.velocity, landingUp);
      if (currentDescent > SHUTTLE_ASSIST_DESCENT_MPS) {
        const excess = currentDescent - SHUTTLE_ASSIST_DESCENT_MPS;
        // descender is positive downward; add the upward correction.
        shuttle.velocity = add(shuttle.velocity, scale(landingUp, excess));
      }
      const horizontal = add(shuttle.velocity, scale(landingUp, -dot(shuttle.velocity, landingUp)));
      const horizontalSpeed = Math.hypot(horizontal.x, horizontal.y, horizontal.z);
      if (horizontalSpeed > SHUTTLE_ASSIST_SPEED_MPS) {
        const damped = Math.max(0, SHUTTLE_ASSIST_SPEED_MPS / horizontalSpeed);
        shuttle.velocity = add(scale(horizontal, damped), scale(landingUp, dot(shuttle.velocity, landingUp)));
      }
      if (!lifting && thrust === 0) {
        const vertical = scale(landingUp, dot(shuttle.velocity, landingUp));
        const lateral = add(shuttle.velocity, scale(vertical, -1));
        shuttle.velocity = add(vertical, scale(lateral, Math.exp(-SHUTTLE_APPROACH_BRAKE_RATE * dt)));
      }
      // Legs on a slope can rest a little above the center ray's hit; a
      // stopped ship within a meter is also contact, otherwise it would sit
      // there in "airborne" forever and E could never disembark.
      const contact =
        ground !== null &&
        (ground <= SHUTTLE_GROUND_CLEARANCE_M + 0.35 ||
          (shuttleSpeed(shuttle) < 0.5 && ground < 1));
      if (ground !== null && contact && descender >= 0) {
        if (descender <= SHUTTLE_SAFE_TOUCHDOWN_MPS) {
          // Safe touchdown: seat the origin on its legs and rest.
          entity.position = add(entity.position, scale(landingUp, SHUTTLE_GROUND_CLEARANCE_M - ground));
          shuttle.velocity = { ...ZERO };
          shuttle.airborne = false;
          shuttle.launchChargeS = 0;
          shuttle.up = landingUp;
          shuttle.pitch = 0;
        } else {
          // Fast contact bounces instead of damaging (out of scope v1). The
          // pre-clamp descender sizes the bounce; the vertical component is
          // replaced so the assist correction cannot double it.
          const bounce = descender * SHUTTLE_BOUNCE_DAMP;
          const vertical = dot(shuttle.velocity, landingUp);
          shuttle.velocity = add(shuttle.velocity, scale(landingUp, bounce - vertical));
        }
      }
    }
  }

  // 9) Position: the planet body integrates on the next central step; deep
  // space integrates the world doubles directly (no terrain to collide).
  if (!planet) {
    entity.position = add(entity.position, scale(shuttle.velocity, dt));
  }
  entity.rotation = shuttleOrientation(shuttle.up, shuttle.yaw, shuttle.pitch);
  if (planet) body.write(planet, entity.position, entity.rotation, shuttle.velocity);
  syncPilot(world, entity, shuttle.pilotId);
}

/** Keep the attached pilot entity on the shuttle transform. */
function syncPilot(world: World, shuttleEntity: Entity, pilotId: EntityId | null): void {
  if (!pilotId) return;
  const pilot = world.entities.get(pilotId);
  if (!pilot || pilot.components.player?.pilotingShuttleId !== shuttleEntity.id) return;
  attachPilotToShuttle(pilot, shuttleEntity);
}
