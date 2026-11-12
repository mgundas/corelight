// M09 light-stick re-seating: static sticks follow terrain edits instead of
// floating over a fresh hole (or being buried by added soil).

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { events } from '../../src/core/events.js';
import { World } from '../../src/sim/world.js';
import { updateLightsticks } from '../../src/sim/systems/lightsticks.js';
import { createDensityField } from '../../src/terrain/density.js';
import type { EntityId } from '../../src/sim/entities.js';

function flatPlanet(): PlanetConfig {
  return {
    ...SELA,
    id: 'flat',
    name: 'Flat test world',
    seed: 4242,
    surfaceAmplitude: 0,
    caves: { ...SELA.caves, thresholdTop: 0, thresholdBottom: 0, startDepth: 10000 },
    caverns: { ...SELA.caverns, enabled: false },
  };
}

function world(): { world: World; playerId: EntityId; planet: PlanetConfig } {
  const planet = flatPlanet();
  const w = new World(7, { planets: [planet] });
  w.addSystem((tickWorld) => updateLightsticks(tickWorld));
  w.dispatch({
    type: 'spawnPlayer',
    planetId: planet.id,
    position: { x: 0, y: planet.radius + 0.9, z: 2 },
  });
  w.tick();
  const playerId = [...w.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  return { world: w, playerId, planet };
}

function give(w: World, playerId: EntityId, itemId: string): void {
  const player = w.entities.get(playerId);
  const inv = player?.components.inventory;
  if (!player || !inv) throw new Error('no inventory');
  const id = w.nextId('item');
  w.entities.set(id, {
    id,
    kind: 'item',
    planetId: player.planetId,
    position: { ...player.position },
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId, holder: playerId } },
  });
  inv.slots[0] = id;
  inv.selectedSlot = 0;
}

describe('light-stick terrain re-seating', () => {
  it('drops a stick into a hole dug under it', () => {
    const { world: w, playerId } = world();
    give(w, playerId, 'light_stick');
    w.dispatch({ type: 'placeLightstick', playerId });
    w.tick();
    const stick = [...w.entities.values()].find((e) => e.kind === 'lightstick');
    if (!stick) throw new Error('no light stick');
    const before = stick.position.y;
    // Dig the ground out from under the stick (it is 1.5 m ahead).
    w.dispatch({
      type: 'terrainEdit',
      playerId,
      planetId: 'flat',
      mode: 'dig',
      center: { ...stick.position },
      radius: 2,
      strength: 5,
    });
    w.tick();
    expect(w.entities.has(stick.id)).toBe(true);
    expect(stick.position.y).toBeLessThan(before - 0.2);
    // Still seated near the new surface (0.25 m march + bisection).
    const planet = w.planets[0] as PlanetConfig;
    const local = {
      x: stick.position.x - planet.center.x,
      y: stick.position.y - planet.center.y,
      z: stick.position.z - planet.center.z,
    };
    const field = createDensityField(planet, w.seed, (x, y, z) =>
      w.terrainEdits.deltaAt(planet, planet.id, x, y, z),
    );
    expect(Math.abs(field.density(local.x, local.y, local.z))).toBeLessThan(0.6);
  });

  it('leaves sticks alone when a different planet is edited', () => {
    const { world: w, playerId } = world();
    give(w, playerId, 'light_stick');
    w.dispatch({ type: 'placeLightstick', playerId });
    w.tick();
    const stick = [...w.entities.values()].find((e) => e.kind === 'lightstick');
    if (!stick) throw new Error('no light stick');
    const before = { ...stick.position };
    // A dirty planet that owns no stick must not move this one.
    events.emit('terrainEdited', { planetId: 'sela', keys: ['sela:0:1:2:3'] });
    w.tick();
    expect(stick.position).toEqual(before);
  });
});
