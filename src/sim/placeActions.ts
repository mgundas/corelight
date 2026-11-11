// Placement + light-stick actions (M09). Pure sim-side validation: the
// client ghost calls checkPlacement() for tinting, but only the action
// mutates the world. Grounded placement is rejected on steep terrain, inside
// rock, under low ceilings and when another structure occupies the spot.

import {
  PLACE_MAX_SLOPE_DEG,
  PLACE_RANGE_M,
  PLACE_SURFACE_TOLERANCE,
} from '../core/constants.js';
import { events } from '../core/events.js';
import { distance, dot, normalize, quatFromTo, type Vec3d } from '../core/math.js';
import {
  placeableById,
  placeableForMachineType,
  type PlaceableDef,
} from '../data/loadPlaceables.js';
import type { Entity, EntityId, MachineType } from './entities.js';
import { inventoryFor } from './inventoryActions.js';
import { upAt } from './physics/frames.js';
import { normalAt } from './nodes.js';
import { baseFieldFor, seatAheadOnGround } from './tetherActions.js';
import type { World } from './world.js';

const SLOPE_COS = Math.cos((PLACE_MAX_SLOPE_DEG * Math.PI) / 180);
/** Occupied-spot spacing: footprint sums shrink slightly so touching is ok. */
const SPACING_FACTOR = 0.9;
/** Samples checked around the footprint ring (8 directions). */
const RING_SAMPLES = 8;

export interface PlacementCheck {
  ok: boolean;
  /** Short player-facing reason when !ok (HUD prompt). */
  reason: string | null;
}

/** Ground normal within PLACE_MAX_SLOPE_DEG of local up (pure, for tests). */
export function isGroundFlat(normal: Vec3d, up: Vec3d): boolean {
  return dot(normal, up) >= SLOPE_COS;
}

/** Live (edited) density in planet-local coordinates, cached base field. */
function liveDensity(world: World, planetId: string): (x: number, y: number, z: number) => number {
  const base = baseFieldFor(world, planetId);
  const planet = world.planets.find((p) => p.id === planetId);
  if (!planet) return () => 0;
  return (x, y, z) => base.density(x, y, z) + world.terrainEdits.deltaAt(planet, planetId, x, y, z);
}

/** Footprint of an existing structure (habitats fall back to the kit def). */
function structureFootprint(entity: Entity): number {
  const byId = entity.components.placeable?.placeableId;
  if (byId) return placeableById(byId)?.footprintRadiusM ?? 1;
  const machineType = entity.components.machine?.machineType;
  if (machineType) return placeableForMachineType(machineType)?.footprintRadiusM ?? 1;
  return 1;
}

/**
 * Can a placeable stand here? Ground must be near the surface, its normal
 * within PLACE_MAX_SLOPE_DEG of local up, clear of rock above the footprint,
 * and not overlapping another platform/machine/shuttle.
 */
export function checkPlacement(
  world: World,
  planetId: string,
  placeableId: string,
  position: Vec3d,
): PlacementCheck {
  const def = placeableById(placeableId);
  const planet = world.planets.find((p) => p.id === planetId);
  if (!def || !planet) return { ok: false, reason: 'Unknown placeable' };
  if (
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(position.z)
  ) {
    return { ok: false, reason: 'Invalid position' };
  }
  const up = upAt(planet, position);
  const local = {
    x: position.x - planet.center.x,
    y: position.y - planet.center.y,
    z: position.z - planet.center.z,
  };
  const live = liveDensity(world, planetId);
  const d = live(local.x, local.y, local.z);
  if (d > PLACE_SURFACE_TOLERANCE) return { ok: false, reason: 'Inside rock' };
  if (d < -PLACE_SURFACE_TOLERANCE) return { ok: false, reason: 'Aim at the ground' };
  const normal = normalAt(live, local);
  if (!isGroundFlat(normal, up)) {
    const flatness = dot(normal, up);
    const slopeDeg = Math.round((Math.acos(Math.max(-1, Math.min(1, flatness))) * 180) / Math.PI);
    return { ok: false, reason: `Too steep (${slopeDeg}°)` };
  }
  // Clearance above the footprint: low cave ceilings block tall machines.
  const clearance = Math.max(0.5, def.heightM * 0.7);
  const centerClear = live(
    local.x + up.x * clearance,
    local.y + up.y * clearance,
    local.z + up.z * clearance,
  );
  if (centerClear >= 0) return { ok: false, reason: 'Not enough headroom' };
  // Any stable lateral frame works: use two axes perpendicular to up.
  const ref = Math.abs(up.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const right = normalize({
    x: up.y * ref.z - up.z * ref.y,
    y: up.z * ref.x - up.x * ref.z,
    z: up.x * ref.y - up.y * ref.x,
  });
  const fwd = normalize({
    x: up.y * right.z - up.z * right.y,
    y: up.z * right.x - up.x * right.z,
    z: up.x * right.y - up.y * right.x,
  });
  for (let i = 0; i < RING_SAMPLES; i += 1) {
    const angle = (i / RING_SAMPLES) * Math.PI * 2;
    const lateral = {
      x: right.x * Math.cos(angle) + fwd.x * Math.sin(angle),
      y: right.y * Math.cos(angle) + fwd.y * Math.sin(angle),
      z: right.z * Math.cos(angle) + fwd.z * Math.sin(angle),
    };
    for (const fraction of [0.6, 1]) {
      const r = def.footprintRadiusM * fraction;
      const px = local.x + lateral.x * r + up.x * clearance;
      const py = local.y + lateral.y * r + up.y * clearance;
      const pz = local.z + lateral.z * r + up.z * clearance;
      if (live(px, py, pz) >= 0) return { ok: false, reason: 'Space is blocked' };
    }
  }
  for (const entity of world.entities.values()) {
    if (entity.planetId !== planetId) continue;
    if (entity.kind !== 'platform' && entity.kind !== 'machine' && entity.kind !== 'shuttle') continue;
    const sum = def.footprintRadiusM + structureFootprint(entity);
    if (distance(entity.position, position) < sum * SPACING_FACTOR) {
      return { ok: false, reason: 'Too close to another structure' };
    }
  }
  return { ok: true, reason: null };
}

const MACHINE_TYPES: ReadonlySet<string> = new Set([
  'habitat',
  'small_printer',
  'medium_printer',
  'solar_panel',
  'battery',
  'furnace',
  'research_station',
  'refinery',
]);

/** Create a placed entity for a catalog placeable (also used by setup). */
export function spawnPlaceableEntity(
  world: World,
  planetId: string,
  placeableId: string,
  position: Vec3d,
): EntityId | null {
  const def = placeableById(placeableId);
  const planet = world.planets.find((p) => p.id === planetId);
  if (!def || !planet) return null;
  const id = world.nextId(def.entityKind);
  const rotation = quatFromTo({ x: 0, y: 1, z: 0 }, upAt(planet, position));
  const components: Entity['components'] = { placeable: { placeableId: def.id } };
  if (def.entityKind === 'machine' && def.machineType && MACHINE_TYPES.has(def.machineType)) {
    components.machine = { machineType: def.machineType as MachineType };
    if (def.machineType === 'small_printer' || def.machineType === 'medium_printer' || def.machineType === 'furnace' || def.machineType === 'refinery') {
      components.printer = { recipeId: null, progressS: 0, inputs: [], outputReady: null };
    }
  }
  world.entities.set(id, {
    id,
    kind: def.entityKind,
    planetId: planet.id,
    position: { ...position },
    rotation: { ...rotation },
    components,
  });
  return id;
}

/** Setup/debug action: place a catalog object without a package. */
export function spawnPlaceable(world: World, planetId: string, placeableId: string, position: Vec3d): void {
  spawnPlaceableEntity(world, planetId, placeableId, position);
  events.emit('actionApplied', { type: 'spawnPlaceable' });
}

function findPackage(
  world: World,
  player: Entity,
  def: PlaceableDef,
): { itemId: EntityId; slot: number | null } | null {
  const playerComp = player.components.player;
  const inventory = player.components.inventory;
  const carriedId = playerComp?.carryingLarge;
  if (carriedId) {
    const item = world.entities.get(carriedId);
    if (item?.components.item?.itemId === def.packageItem) return { itemId: carriedId, slot: null };
  }
  if (!inventory) return null;
  for (let i = 0; i < inventory.slots.length; i += 1) {
    const id = inventory.slots[i];
    if (!id) continue;
    if (world.entities.get(id)?.components.item?.itemId === def.packageItem) {
      return { itemId: id, slot: i };
    }
  }
  return null;
}

/** Unpack the carried package into a placed entity (ghost click / action). */
export function placePlaceable(
  world: World,
  playerId: EntityId,
  placeableId: string,
  position: Vec3d,
): void {
  const player = world.entities.get(playerId);
  const playerComp = player?.components.player;
  const inventory = player ? inventoryFor(world, playerId) : null;
  const def = placeableById(placeableId);
  if (!player || !playerComp || !inventory || !def || !player.planetId) {
    events.emit('actionApplied', { type: 'placePlaceable' });
    return;
  }
  if (distance(player.position, position) > PLACE_RANGE_M) {
    events.emit('actionApplied', { type: 'placePlaceable' });
    return;
  }
  const check = checkPlacement(world, player.planetId, placeableId, position);
  if (!check.ok) {
    events.emit('actionApplied', { type: 'placePlaceable' });
    return;
  }
  const pkg = findPackage(world, player, def);
  if (!pkg) {
    events.emit('actionApplied', { type: 'placePlaceable' });
    return;
  }
  if (pkg.slot === null) {
    if (playerComp.carryingLarge === pkg.itemId) playerComp.carryingLarge = null;
  } else {
    inventory.slots[pkg.slot] = null;
  }
  world.entities.delete(pkg.itemId);
  spawnPlaceableEntity(world, player.planetId, def.id, position);
  events.emit('actionApplied', { type: 'placePlaceable' });
}

/**
 * E on the ground with a light stick: spend one backpack stick, seat it on
 * the surface ahead of the player, and leave a static emitter behind.
 */
export function placeLightstick(world: World, playerId: EntityId): void {
  const player = world.entities.get(playerId);
  const inventory = player ? inventoryFor(world, playerId) : null;
  const playerComp = player?.components.player;
  const planet = player?.planetId ? world.planets.find((p) => p.id === player.planetId) : undefined;
  if (!player || !inventory || !playerComp || !planet) {
    events.emit('actionApplied', { type: 'placeLightstick' });
    return;
  }
  const slots = inventory.slots;
  const selected = slots[inventory.selectedSlot];
  let slot = selected && world.entities.get(selected)?.components.item?.itemId === 'light_stick'
    ? inventory.selectedSlot
    : slots.findIndex(
        (id) => id !== null && world.entities.get(id)?.components.item?.itemId === 'light_stick',
      );
  if (slot === -1) {
    events.emit('actionApplied', { type: 'placeLightstick' });
    return;
  }
  const spentId = slots[slot] as EntityId;
  world.entities.delete(spentId);
  slots[slot] = null;
  const position = seatAheadOnGround(world, planet, player.position, playerComp.yaw);
  const id = world.nextId('lightstick');
  world.entities.set(id, {
    id,
    kind: 'lightstick',
    planetId: planet.id,
    position,
    rotation: { ...quatFromTo({ x: 0, y: 1, z: 0 }, upAt(planet, position)) },
    // The item component carries the glow definition (items.json) into the
    // renderer; kind 'lightstick' keeps it out of the physics/backpack paths.
    components: { item: { itemId: 'light_stick' } },
  });
  events.emit('actionApplied', { type: 'placeLightstick' });
}
