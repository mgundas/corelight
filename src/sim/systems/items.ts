// Item physics (M07): loose items are Rapier dynamic bodies with custom
// spherical gravity. The global Rapier gravity stays zero (ARCHITECTURE.md);
// each tick the system integrates the planet pull into each loose item's
// velocity by hand and steps the world once per planet, so items fall and
// rest on the same trimesh terrain the player stands on. Carried items
// (holder set) own no body and are skipped.

import RAPIER from '@dimforge/rapier3d-compat';
import { ITEM_BODY_RADIUS } from '../../core/constants.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import type { Entity, EntityId } from '../entities.js';
import { toLocalFrame, toWorldFrame } from '../physics/frames.js';
import { gravityAt } from '../physics/gravity.js';
import type { World } from '../world.js';

export interface ItemsOptions {
  planets: PlanetConfig[];
  worldFor: (planetId: string) => RAPIER.World;
}

interface ItemBody {
  body: RAPIER.RigidBody;
  planetId: string;
}

export function makeItemsSystem(opts: ItemsOptions): (world: World, dt: number) => void {
  const bodies = new Map<EntityId, ItemBody>();

  return (world: World, dt: number) => {
    // Drop bodies for deleted, carried, or planet-swapped items.
    for (const [id, entry] of [...bodies]) {
      const entity = world.entities.get(id);
      const held = entity?.components.item?.holder !== undefined;
      if (!entity || entity.kind !== 'item' || held || entity.planetId !== entry.planetId) {
        try {
          opts.worldFor(entry.planetId).removeRigidBody(entry.body);
        } catch {
          // World already disposed in tests; nothing to do.
        }
        bodies.delete(id);
      }
    }
    const stepped = new Set<string>();
    const touched: { entity: Entity; entry: ItemBody }[] = [];
    for (const entity of world.entities.values()) {
      if (entity.kind !== 'item' || entity.components.item?.holder !== undefined) continue;
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
      // Custom gravity: Rapier global gravity is zero, so integrate the
      // spherical pull into the body velocity by hand each tick.
      const linvel = entry.body.linvel();
      entry.body.setLinvel(
        {
          x: linvel.x + sample.vector.x * dt,
          y: linvel.y + sample.vector.y * dt,
          z: linvel.z + sample.vector.z * dt,
        },
        true,
      );
      touched.push({ entity, entry });
      stepped.add(planet.id);
    }
    // One deterministic step per touched planet, then read positions back.
    for (const planetId of stepped) {
      const rapierWorld = opts.worldFor(planetId);
      rapierWorld.timestep = dt;
      rapierWorld.step();
    }
    for (const { entity, entry } of touched) {
      const planet = opts.planets.find((p) => p.id === entry.planetId);
      if (!planet) continue;
      const t = entry.body.translation();
      entity.position = toWorldFrame(planet, { x: t.x, y: t.y, z: t.z });
    }
  };
}
