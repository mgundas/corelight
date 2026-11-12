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
import type { Vec3d } from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { isItemLike, type EntityId } from '../entities.js';
import { toLocalFrame, toWorldFrame, transferPlanetId } from '../physics/frames.js';
import { gravityAt } from '../physics/gravity.js';
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

  return (world: World, dt: number) => {
    // SOI handoff (M13): relabel loose items by the dominant planet before
    // the body bookkeeping below, so a body left in the old planet world is
    // dropped and recreated in the new one on this tick.
    for (const entity of world.entities.values()) {
      if (!isItemLike(entity) || entity.components.item?.holder !== undefined) continue;
      entity.planetId = transferPlanetId(opts.planets, entity.position);
    }
    // Drop bodies for deleted, carried, grabbed, or planet-swapped items.
    for (const [id, entry] of [...bodies]) {
      const entity = world.entities.get(id);
      const held = entity?.components.item?.holder !== undefined;
      const grabbed = entity?.components.item?.grabbedBy !== undefined;
      if (!entity || !isItemLike(entity) || held || grabbed || entity.planetId !== entry.planetId) {
        try {
          opts.worldFor(entry.planetId).removeRigidBody(entry.body);
        } catch {
          // World already disposed in tests; nothing to do.
        }
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
      const sample = gravityAt(opts.planets, entity.position);
      if (!sample.planet) continue;
      const planet = sample.planet;
      let entry = bodies.get(entity.id);
      if (!entry) {
        const rapierWorld = opts.worldFor(planet.id);
        const local = toLocalFrame(planet, entity.position);
        const body = rapierWorld.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic().setTranslation(local.x, local.y, local.z),
        );
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
