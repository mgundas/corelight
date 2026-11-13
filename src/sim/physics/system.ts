// Physics system: runs every sim tick (ARCHITECTURE.md order: first).
// Per player: refresh the collider ring, freeze while the ground chunk is
// still loading, otherwise integrate movement, then run the embedded-safety
// push-out. Bodies are owned here (one PlayerBody per player entity).

import type * as RAPIER from '@dimforge/rapier3d-compat';
import {
  EMBED_DENSITY_THRESHOLD,
  EMBED_ESCAPE_S,
  EMBED_ESCAPE_SPEED,
  EMBED_GRACE_S,
  EMBED_PUSH_SPEED,
} from '../../core/constants.js';
import { length, normalize, scale, type Vec3d } from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { createDensityField, type DensityField } from '../../terrain/density.js';
import type { TerrainEdits } from '../../terrain/edits.js';
import type { Entity, EntityId } from '../entities.js';
import type { System } from '../world.js';
import { PlayerBody } from './characterController.js';
import { toLocalFrame, transferPlanetId, upAt } from './frames.js';
import { gravityAt } from './gravity.js';
import { physicsWorldFor, stepPlanetWorlds } from './rapierWorld.js';
import { TerrainColliders } from './terrainColliders.js';

export interface PhysicsOptions {
  planets: PlanetConfig[];
  worldSeed: number;
  colliders: TerrainColliders;
  worldFor?: (planetId: string) => RAPIER.World;
  /** Player edits: the safety net must see the same ground as the player. */
  edits?: TerrainEdits;
}

function densityGradient(field: DensityField, local: Vec3d): Vec3d {
  const eps = 0.5;
  const dx =
    field.density(local.x + eps, local.y, local.z) - field.density(local.x - eps, local.y, local.z);
  const dy =
    field.density(local.x, local.y + eps, local.z) - field.density(local.x, local.y - eps, local.z);
  const dz =
    field.density(local.x, local.y, local.z + eps) - field.density(local.x, local.y, local.z - eps);
  // Central difference over 2*eps.
  return { x: dx / (2 * eps), y: dy / (2 * eps), z: dz / (2 * eps) };
}

/** Push a deeply embedded player out along the inverse density gradient.
 * Returns true while the capsule center is inside solid terrain: the caller
 * must skip normal integration (gravity would only fight the push-out). */
export function safetyStep(entity: Entity, fields: Map<string, DensityField>, planets: PlanetConfig[], dt: number): boolean {
  const player = entity.components.player;
  if (!player) return false;
  const sample = gravityAt(planets, entity.position);
  if (!sample.planet) {
    player.embeddedTime = 0;
    player.escaping = false;
    return false;
  }
  const field = fields.get(sample.planet.id);
  if (!field) return false;
  const local = toLocalFrame(sample.planet, entity.position);
  const d = field.density(local.x, local.y, local.z);
  if (player.escaping) {
    // Sticky escape: thin dips must not hand control back to the
    // controller (it would drop the player and restart the timer).
    // Stand down only in open air.
    if (d < 0) {
      player.embeddedTime = 0;
      player.escaping = false;
      return false;
    }
  } else if (d <= EMBED_DENSITY_THRESHOLD) {
    player.embeddedTime = 0;
    return false;
  }
  player.embeddedTime += dt;
  // Freeze normal integration while embedded (gravity would only build a
  // fall velocity that fights the push-out; solid chunks have no trimesh
  // surface to land on anyway).
  player.velocity = { x: 0, y: 0, z: 0 };
  player.grounded = false;
  if (player.embeddedTime < EMBED_GRACE_S) return true;
  // Latch escape mode once gradient descent proves fruitless: it survives
  // thin dips and guarantees termination at the surface.
  if (player.embeddedTime >= EMBED_GRACE_S + EMBED_ESCAPE_S) player.escaping = true;
  const grad = densityGradient(field, local);
  // Gradient descent toward the nearest wall. In flat spots (local minima
  // of the noise field, where the gradient vanishes above the threshold)
  // descent stalls, so fall back to pushing toward the surface: any steady
  // direction walks out of a point minimum, and the gradient takes over
  // again outside it. Escape plows steadily surface-ward at full speed:
  // the surface is always air, so this terminates.
  const descending = !player.escaping && length(grad) >= 0.05;
  const out = descending ? normalize(scale(grad, -1)) : upAt(sample.planet, entity.position);
  const step = player.escaping
    ? Math.min(2, EMBED_ESCAPE_SPEED * dt)
    : Math.min(2, EMBED_PUSH_SPEED * dt * (1 + Math.min(d, 24)));
  entity.position = {
    x: entity.position.x + out.x * step,
    y: entity.position.y + out.y * step,
    z: entity.position.z + out.z * step,
  };
  return true;
}

export function makePhysicsSystem(opts: PhysicsOptions): System {
  const fields = new Map<string, DensityField>(
    opts.planets.map((planet) => [
      planet.id,
      createDensityField(planet, opts.worldSeed, (x, y, z) =>
        opts.edits ? opts.edits.deltaAt(planet, planet.id, x, y, z) : 0,
      ),
    ]),
  );
  const bodies = new Map<EntityId, PlayerBody>();
  const worldFor = opts.worldFor ?? physicsWorldFor;

  return (world, dt) => {
    for (const [id, body] of bodies) {
      if (!world.entities.has(id)) {
        body.dispose();
        bodies.delete(id);
      }
    }
    for (const entity of world.entities.values()) {
      if (entity.kind !== 'player' || !entity.components.player) continue;
      // SOI handoff (M13): the dominant planet owns the frame. Relabel first
      // so colliders, oxygen, nodes and tether systems all agree this tick;
      // the controller rebinds to the new Rapier world when it steps.
      const dominant = transferPlanetId(opts.planets, entity.position);
      if (entity.planetId !== dominant) entity.planetId = dominant;
      opts.colliders.update(entity.position, opts.planets, opts.worldSeed);
      // A pilot is attached to a shuttle: the shuttle system owns their
      // motion and the astronaut collider must not fight the ship body.
      if (entity.components.player.pilotingShuttleId) {
        const pilotBody = bodies.get(entity.id);
        if (pilotBody) {
          pilotBody.dispose();
          bodies.delete(entity.id);
        }
        continue;
      }
      // Embedded safety first: inside solid rock normal integration only
      // builds fall velocity (solid chunks have no trimesh), so freeze and
      // push out instead. Works even while colliders are still loading.
      if (safetyStep(entity, fields, opts.planets, dt)) continue;
      if (opts.colliders.groundState(entity.position, opts.planets) !== 'ready') {
        // Colliders not loaded yet: freeze instead of falling through.
        continue;
      }
      let body = bodies.get(entity.id);
      if (!body) {
        body = new PlayerBody(worldFor);
        bodies.set(entity.id, body);
      }
      body.step(entity, opts.planets, dt);
    }
    // Single stepping authority: one step per planet world per tick, after
    // every controller and item body has written its intent. Shared worlds
    // must not step per body (loose items would integrate 2x fast).
    stepPlanetWorlds(dt);
  };
}
