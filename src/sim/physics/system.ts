// Physics system: runs every sim tick (ARCHITECTURE.md order: first).
// Per player: refresh the collider ring, freeze while the ground chunk is
// still loading, otherwise integrate movement, then run the embedded-safety
// push-out. Bodies are owned here (one PlayerBody per player entity).

import RAPIER from '@dimforge/rapier3d-compat';
import { EMBED_DENSITY_THRESHOLD, EMBED_GRACE_S, EMBED_PUSH_SPEED } from '../../core/constants.js';
import { length, normalize, scale, type Vec3d } from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { createDensityField, type DensityField } from '../../terrain/density.js';
import type { Entity, EntityId } from '../entities.js';
import type { System } from '../world.js';
import { PlayerBody } from './characterController.js';
import { toLocalFrame } from './frames.js';
import { gravityAt } from './gravity.js';
import { physicsWorldFor } from './rapierWorld.js';
import { TerrainColliders } from './terrainColliders.js';

export interface PhysicsOptions {
  planets: PlanetConfig[];
  worldSeed: number;
  colliders: TerrainColliders;
  worldFor?: (planetId: string) => RAPIER.World;
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
    return false;
  }
  const field = fields.get(sample.planet.id);
  if (!field) return false;
  const local = toLocalFrame(sample.planet, entity.position);
  const d = field.density(local.x, local.y, local.z);
  if (d <= EMBED_DENSITY_THRESHOLD) {
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
  const grad = densityGradient(field, local);
  if (length(grad) < 1e-6) return true;
  const out = normalize(scale(grad, -1));
  // Scale with depth so deep burials (bad teleports) exit in seconds while
  // shallow grazes ease out gently. Capped per tick to avoid overshooting
  // across thin walls.
  const step = Math.min(2, EMBED_PUSH_SPEED * dt * (1 + Math.min(d, 24)));
  entity.position = {
    x: entity.position.x + out.x * step,
    y: entity.position.y + out.y * step,
    z: entity.position.z + out.z * step,
  };
  return true;
}

export function makePhysicsSystem(opts: PhysicsOptions): System {
  const fields = new Map<string, DensityField>(
    opts.planets.map((planet) => [planet.id, createDensityField(planet, opts.worldSeed)]),
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
      opts.colliders.update(entity.position, opts.planets, opts.worldSeed);
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
  };
}
