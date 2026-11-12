// Power networks (M10): generation, working-machine demand, storage and
// brownout pausing. The graph is rebuilt only when the topology changes
// (cables, snapped platforms, attached machines); this system reuses the
// cached members and recomputes energy every tick.
//
// Priority: printers (small/medium/research) first, then furnace, then
// refinery. On a brownout the lowest priority working machine pauses first.
// Interpretation: "printers first" is the keep-alive order in the prompt;
// the whole machine pauses, never partial progress.
//
// Storage: batteries are 100 each, the habitat has an internal 20. Charging
// tops the habitat first, then batteries; discharging drains batteries first
// and keeps the habitat's reserve for the starting base.

import {
  POWER_HABITAT_GEN,
  POWER_SOLAR_GEN,
} from '../../core/constants.js';
import { dot } from '../../core/math.js';
import { recipeById } from '../../data/loadRecipes.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import type { Entity } from '../entities.js';
import type { World } from '../world.js';
import { upAt } from '../physics/frames.js';
import { ensurePower, powerNetworksFor } from '../powerGraph.js';
import { isDaylight } from './sun.js';

interface Consumer {
  entity: Entity;
  power: number;
  rank: number;
}

/** Keep-alive priority: printers, furnace, refinery, everything else. */
export function powerPriority(entity: Entity): number {
  switch (entity.components.machine?.machineType) {
    case 'small_printer':
    case 'medium_printer':
    case 'research_station':
      return 0;
    case 'furnace':
      return 1;
    case 'refinery':
      return 2;
    default:
      return 3;
  }
}

/** Solar output (power/s): 2 at noon, 0 at night, cosine with local up. */
export function solarOutput(world: World, planet: PlanetConfig, entity: Entity): number {
  const local = {
    x: entity.position.x - planet.center.x,
    y: entity.position.y - planet.center.y,
    z: entity.position.z - planet.center.z,
  };
  if (!isDaylight(world, planet.id, local)) return 0;
  const up = upAt(planet, entity.position);
  return POWER_SOLAR_GEN * Math.max(0, dot(world.sunDirection, up));
}

function consumersFor(members: Entity[]): Consumer[] {
  const consumers: Consumer[] = [];
  for (const entity of members) {
    if (entity.kind !== 'machine') continue;
    const printer = entity.components.printer;
    if (!printer || printer.recipeId === null) continue;
    const recipe = recipeById(printer.recipeId);
    if (!recipe || recipe.power <= 0) continue;
    consumers.push({ entity, power: recipe.power, rank: powerPriority(entity) });
  }
  return consumers;
}

function storageRank(entity: Entity, charging: boolean): number {
  const habitat = entity.components.machine?.machineType === 'habitat';
  if (charging) return habitat ? 0 : 1;
  return habitat ? 1 : 0;
}

function moveEnergy(storages: Entity[], energy: number, charging: boolean): void {
  const order = [...storages].sort((a, b) => {
    const rank = storageRank(a, charging) - storageRank(b, charging);
    if (rank !== 0) return rank;
    return a.id < b.id ? -1 : 1;
  });
  let left = energy;
  for (const entity of order) {
    if (left <= 1e-9) break;
    const power = ensurePower(entity);
    if (!power) continue;
    if (charging) {
      const add = Math.min(power.capacity - power.stored, left);
      power.stored += add;
      left -= add;
    } else {
      const take = Math.min(power.stored, left);
      power.stored = Math.max(0, power.stored - take);
      left -= take;
    }
  }
}

export function updatePower(world: World, dt: number): void {
  if (!(dt > 0)) return;
  for (const network of powerNetworksFor(world)) {
    const planet = world.planets.find((p) => p.id === network.planetId);
    if (!planet) continue;
    let generation = 0;
    const storages: Entity[] = [];
    for (const member of network.members) {
      const power = ensurePower(member);
      if (!power) continue;
      const type = member.components.machine?.machineType;
      if (type === 'habitat') generation += POWER_HABITAT_GEN;
      else if (type === 'solar_panel') generation += solarOutput(world, planet, member);
      if (power.capacity > 0) storages.push(member);
    }
    const consumers = consumersFor(network.members);
    const demand = consumers.reduce((sum, c) => sum + c.power, 0);
    const storedBefore = storages.reduce(
      (sum, entity) => sum + (entity.components.power?.stored ?? 0),
      0,
    );
    // Running machines only need this tick's energy; a paused machine needs a
    // one-second buffer after higher-priority demand (or enough generation)
    // before it restarts. WHY: using the per-tick energy alone lets a
    // recharging battery chatter a lower-priority machine on for one tick,
    // off for one tick (30 Hz flicker); the buffer makes restarts stable
    // while still draining a running machine to nearly empty.
    const perTickAvailable = generation + (dt > 0 ? storedBefore / dt : 0);
    consumers.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.entity.id < b.entity.id ? -1 : 1;
    });
    const running = new Set<string>();
    let runningDemand = 0;
    for (const consumer of consumers) {
      const wasPaused = consumer.entity.components.power?.paused === true;
      if (wasPaused && generation - runningDemand + storedBefore + 1e-9 < consumer.power) continue;
      if (runningDemand + consumer.power <= perTickAvailable + 1e-9) {
        running.add(consumer.entity.id);
        runningDemand += consumer.power;
      }
    }
    for (const member of network.members) {
      const power = ensurePower(member);
      if (power) power.paused = false;
    }
    for (const consumer of consumers) {
      const power = ensurePower(consumer.entity);
      if (power) power.paused = !running.has(consumer.entity.id);
    }
    const net = generation - runningDemand;
    if (net > 0) moveEnergy(storages, net * dt, true);
    else if (net < 0) moveEnergy(storages, -net * dt, false);
    let stored = 0;
    let capacity = 0;
    for (const member of network.members) {
      const power = ensurePower(member);
      if (!power || power.capacity <= 0) continue;
      stored += power.stored;
      capacity += power.capacity;
    }
    for (const member of network.members) {
      const power = ensurePower(member);
      if (!power) continue;
      power.networkId = network.id;
      power.generation = generation;
      power.demand = demand;
      power.networkStored = stored;
      power.networkCapacity = capacity;
    }
  }
}
