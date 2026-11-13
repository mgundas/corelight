// Item physics (M07): loose items are Rapier dynamic bodies with custom
// spherical gravity. The global Rapier gravity stays zero (ARCHITECTURE.md);
// each tick the system integrates the planet pull into each loose item's
// velocity by hand. Stepping is centralized: the physics system steps every
// planet world once per tick after all intents are written (players and
// items share these worlds, and stepping twice would integrate items 2x
// fast). Positions are read back from the bodies integrated by the previous
// tick's central step, so entity state always reflects resolved contacts.
// Carried items (holder set) own no body and are skipped.

import RAPIER from '@dimforge/rapier3d-compat';
import { ITEM_BODY_RADIUS } from '../../core/constants.js';
import type { Quat, Vec3d } from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { isItemLike, type EntityId } from '../entities.js';
import { toLocalFrame, toWorldFrame } from '../physics/frames.js';
import { gravityAt, type GravitySample } from '../physics/gravity.js';
import type { World } from '../world.js';

export interface ItemsOptions {
  planets: PlanetConfig[];
  worldFor: (planetId: string) => RAPIER.World;
  /**
   * True when the chunk under `position` is simulated (colliders loaded).
   * While false the item freezes (no gravity, zero velocity), mirroring how
   * the physics system freezes the player on 'pending' ground.
   */
  groundReady?: (position: Vec3d) => boolean;
}

interface ItemBody {
  body: RAPIER.RigidBody;
  planetId: string;
}

export function makeItemsSystem(opts: ItemsOptions): (world: World, dt: number) => void {
  const bodies = new Map<EntityId, ItemBody>();
  /** One SOI sample per loose item per tick (relabel + gravity reuse). */
  const samples = new Map<EntityId, GravitySample>();
  /** Motion captured from a body that had to be recreated in another frame. */
  const transferred = new Map<EntityId, { linvel: Vec3d; rotation: Quat }>();
  const removeBody = (entry: ItemBody): void => {
    try {
      opts.worldFor(entry.planetId).removeRigidBody(entry.body);
    } catch {
      // World already disposed in tests; nothing to do.
    }
  };

  return (world: World, dt: number) => {
    samples.clear();
    transferred.clear();
    // SOI handoff (M13): one gravity sample per loose item drives the planet
    // relabel, the body swap and the integration below. A single scan keeps
    // the per-tick cost at one gravityAt per item (M13 review).
    for (const entity of world.entities.values()) {
      if (!isItemLike(entity) || entity.components.item?.holder !== undefined) continue;
      const sample = gravityAt(opts.planets, entity.position);
      samples.set(entity.id, sample);
      entity.planetId = sample.planet?.id ?? null;
    }
    // Drop bodies for deleted, carried, grabbed, or planet-swapped items.
    for (const [id, entry] of [...bodies]) {
      const entity = world.entities.get(id);
      const held = entity?.components.item?.holder !== undefined;
      const grabbed = entity?.components.item?.grabbedBy !== undefined;
      if (!entity || !isItemLike(entity) || held || grabbed) {
        removeBody(entry);
        bodies.delete(id);
        continue;
      }
      if (entity.planetId !== entry.planetId) {
        // Task 5: transfer position, velocity and rotation. Positions are
        // world doubles; the zero-gravity planet worlds mean linvel/rotation
        // are frame-independent, so carry them across the body swap (M13
        // review: a fresh body used to drop in-flight velocity).
        transferred.set(id, {
          linvel: { ...entry.body.linvel() },
          rotation: { ...entry.body.rotation() },
        });
        removeBody(entry);
        bodies.delete(id);
      }
    }
    // Read back positions from bodies moved by the previous tick's central
    // step (contacts resolved there, not here).
    for (const [id, entry] of bodies) {
      const entity = world.entities.get(id);
      const planet = opts.planets.find((p) => p.id === entry.planetId);
      if (!entity || !isItemLike(entity) || !planet) continue;
      const t = entry.body.translation();
      entity.position = toWorldFrame(planet, { x: t.x, y: t.y, z: t.z });
    }
    // Integrate custom gravity into velocities (the central step applies
    // them). Rapier global gravity stays zero. Items whose ground chunk is
    // not loaded freeze instead of falling toward the core (same rule as
    // the player controller's 'pending' ground state).
    for (const entity of world.entities.values()) {
      if (!isItemLike(entity) || entity.components.item?.holder !== undefined) continue;
      if (entity.components.item?.grabbedBy !== undefined) continue;
      if (opts.groundReady && !opts.groundReady(entity.position)) {
        const frozen = bodies.get(entity.id);
        if (frozen) {
          try {
            frozen.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          } catch {
            // Body already removed; nothing to do.
          }
        }
        continue;
      }
      const sample = samples.get(entity.id);
      if (!sample || !sample.planet) continue;
      const planet = sample.planet;
      let entry = bodies.get(entity.id);
      if (!entry) {
        const rapierWorld = opts.worldFor(planet.id);
        const local = toLocalFrame(planet, entity.position);
        // The ball is a shape-independent contact proxy, not a rolling toy.
        // Free rotation defeats static friction even on almost-flat ground.
        let desc = RAPIER.RigidBodyDesc.dynamic().lockRotations().setTranslation(local.x, local.y, local.z);
        const moved = transferred.get(entity.id);
        if (moved) {
          desc = desc
            .setLinvel(moved.linvel.x, moved.linvel.y, moved.linvel.z)
            .setRotation(moved.rotation);
        }
        const body = rapierWorld.createRigidBody(desc);
        rapierWorld.createCollider(RAPIER.ColliderDesc.ball(ITEM_BODY_RADIUS), body);
        entry = { body, planetId: planet.id };
        bodies.set(entity.id, entry);
      }
      if (entry.planetId !== planet.id) continue;
      const linvel = entry.body.linvel();
      entry.body.setLinvel(
        {
          x: linvel.x + sample.vector.x * dt,
          y: linvel.y + sample.vector.y * dt,
          z: linvel.z + sample.vector.z * dt,
        },
        true,
      );
    }
  };
}
