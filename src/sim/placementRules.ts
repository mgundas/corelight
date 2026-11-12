// Ground placement rules (M09, split out in M10). Pure sim-side validation:
// the ghost asks for a verdict but only the action mutates the world. Ground
// must be near the surface, flat enough, clear of rock above the footprint,
// and not overlapping another platform/machine/shuttle. Snapped platform and
// slot-attached placements use their own rules in placeResolve.ts.

import {
  PLACE_MAX_SLOPE_DEG,
  PLACE_SURFACE_TOLERANCE,
} from '../core/constants.js';
import { dot, normalize, type Vec3d } from '../core/math.js';
import { placeableById, placeableForMachineType } from '../data/loadPlaceables.js';
import type { Entity } from './entities.js';
import { upAt } from './physics/frames.js';
import { normalAt } from './nodes.js';
import { baseFieldFor } from './tetherActions.js';
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
export function liveDensity(
  world: World,
  planetId: string,
): (x: number, y: number, z: number) => number {
  const base = baseFieldFor(world, planetId);
  const planet = world.planets.find((p) => p.id === planetId);
  if (!planet) return () => 0;
  return (x, y, z) => base.density(x, y, z) + world.terrainEdits.deltaAt(planet, planetId, x, y, z);
}

/** Footprint of an existing structure (habitats fall back to the kit def). */
export function structureFootprint(entity: Entity): number {
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
    // Footprints are ground-plane areas: compare the lateral offset, not the
    // full 3D distance (a machine 10 m overhead still occupies the column).
    const dx = entity.position.x - position.x;
    const dy = entity.position.y - position.y;
    const dz = entity.position.z - position.z;
    const alongUp = dx * up.x + dy * up.y + dz * up.z;
    const lateral = Math.hypot(dx - up.x * alongUp, dy - up.y * alongUp, dz - up.z * alongUp);
    if (lateral < sum * SPACING_FACTOR) {
      return { ok: false, reason: 'Too close to another structure' };
    }
  }
  return { ok: true, reason: null };
}

/** Lateral clearance for a snapped platform, ignoring the join partner. */
export function checkSnappedClearance(
  world: World,
  planetId: string,
  placeableId: string,
  position: Vec3d,
  ignoreEntityId: string,
): PlacementCheck {
  const def = placeableById(placeableId);
  const planet = world.planets.find((p) => p.id === planetId);
  if (!def || !planet) return { ok: false, reason: 'Unknown placeable' };
  const up = upAt(planet, position);
  for (const entity of world.entities.values()) {
    if (entity.id === ignoreEntityId) continue;
    if (entity.planetId !== planetId) continue;
    if (entity.kind !== 'platform' && entity.kind !== 'machine' && entity.kind !== 'shuttle') continue;
    const sum = def.footprintRadiusM + structureFootprint(entity);
    const dx = entity.position.x - position.x;
    const dy = entity.position.y - position.y;
    const dz = entity.position.z - position.z;
    const alongUp = dx * up.x + dy * up.y + dz * up.z;
    const lateral = Math.hypot(dx - up.x * alongUp, dy - up.y * alongUp, dz - up.z * alongUp);
    if (lateral < sum * SPACING_FACTOR) {
      return { ok: false, reason: 'Too close to another structure' };
    }
  }
  return { ok: true, reason: null };
}
