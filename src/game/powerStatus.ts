// HUD power projection (M10): the aimed machine's network generation,
// requested demand, stored power and the machine state. All numbers come from
// the power component the system writes every tick, so the HUD and sim can
// never disagree. Read-only.

import { placeableForMachineType } from '../data/loadPlaceables.js';
import type { EntityId } from '../sim/entities.js';
import { solarOutput } from '../sim/systems/power.js';
import type { World } from '../sim/world.js';
import { findAimedMachine } from './pickup.js';

export interface PowerStatus {
  generation: number;
  demand: number;
  stored: number;
  capacity: number;
  state: 'working' | 'paused' | 'idle';
}

export interface AimedPowerStatus {
  entityId: EntityId;
  name: string;
  status: PowerStatus;
}

/** Read the aimed machine's network stats, or null when nothing is aimed. */
export function powerStatusFor(world: World, playerId: EntityId | null): AimedPowerStatus | null {
  // The machine cone uses the player's look, not the terrain hit: the readout
  // must appear while aiming at a machine body even when the ray misses.
  if (!playerId) return null;
  const machineId = findAimedMachine(world, playerId);
  if (!machineId) return null;
  const entity = world.entities.get(machineId);
  const power = entity?.components.power;
  if (!entity || !power) return null;
  const printer = entity.components.printer;
  const machineType = entity.components.machine?.machineType;
  const planet = world.planets.find((p) => p.id === entity.planetId);
  const solarWorking =
    machineType === 'solar_panel' && planet !== undefined && solarOutput(world, planet, entity) > 0.01;
  const working = (printer !== undefined && printer.recipeId !== null) || solarWorking;
  const state: PowerStatus['state'] = power.paused ? 'paused' : working ? 'working' : 'idle';
  const name =
    machineType === 'habitat'
      ? 'Habitat'
      : machineType
        ? (placeableForMachineType(machineType)?.name ?? 'Machine')
        : 'Machine';
  return {
    entityId: entity.id,
    name,
    status: {
      generation: power.generation ?? 0,
      demand: power.demand ?? 0,
      stored: power.networkStored ?? power.stored,
      capacity: power.networkCapacity ?? power.capacity,
      state,
    },
  };
}
