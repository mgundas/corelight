// Aimed snap/slot queries (M10). The terrain ray passes through platform
// visuals (they have no colliders), so snapping is picked from the view ray,
// not from the terrain hit point. Pure reads: never mutates the world.

import { CABLE_MAX_LENGTH_M, CABLE_SNAP_RADIUS_M, SNAP_PLACE_RADIUS_M } from '../core/constants.js';
import { dot, length, scale, sub, type Vec3d } from '../core/math.js';
import { placeableById } from '../data/loadPlaceables.js';
import type { EntityId, SlotRef, SnapRef } from '../sim/entities.js';
import { moveBasis, upAt } from '../sim/physics/frames.js';
import type { PlacementTarget } from '../sim/placeResolve.js';
import {
  defForEntity,
  slotFree,
  slotWorld,
  snapFree,
  snapWorld,
} from '../sim/snapUtils.js';
import type { World } from '../sim/world.js';
import { HEAD_HEIGHT } from '../player/cameraRig.js';
import type { ToolAim } from '../player/terrainTool.js';

export interface AimRay {
  origin: Vec3d;
  dir: Vec3d;
}

/** View ray: the cached aim ray, else the player head + look direction. */
export function aimRayFor(world: World, playerId: EntityId, aim: ToolAim): AimRay | null {
  if (aim.ray) return { origin: { ...aim.ray.origin }, dir: { ...aim.ray.dir } };
  const player = world.entities.get(playerId);
  const playerComp = player?.components.player;
  const planet = player?.planetId ? world.planets.find((p) => p.id === player.planetId) : undefined;
  if (!player || !playerComp || !planet) return null;
  const up = upAt(planet, player.position);
  const { forward } = moveBasis(up, playerComp.yaw, playerComp.pitch);
  return {
    origin: {
      x: player.position.x + up.x * HEAD_HEIGHT,
      y: player.position.y + up.y * HEAD_HEIGHT,
      z: player.position.z + up.z * HEAD_HEIGHT,
    },
    dir: forward,
  };
}

interface RayPick {
  t: number;
  perp: number;
}

/** Project a point onto the ray; null outside range or the pick radius. */
function pickOnRay(ray: AimRay, point: Vec3d, radius: number, maxDist: number): RayPick | null {
  const to = sub(point, ray.origin);
  const t = dot(to, ray.dir);
  if (t < 0 || t > maxDist) return null;
  const perp = length(sub(to, scale(ray.dir, t)));
  if (perp > radius) return null;
  return { t, perp };
}

/** Nearest catalog snap point under the aim ray (occupied snaps included). */
export function findAimedSnap(
  world: World,
  playerId: EntityId,
  aim: ToolAim,
  requireFree = false,
): SnapRef | null {
  const ray = aimRayFor(world, playerId, aim);
  const player = world.entities.get(playerId);
  if (!ray || !player?.planetId) return null;
  const planet = world.planets.find((p) => p.id === player.planetId);
  if (!planet) return null;
  let best: { ref: SnapRef; pick: RayPick } | null = null;
  for (const entity of world.entities.values()) {
    if (entity.planetId !== planet.id) continue;
    if (entity.kind !== 'platform' && entity.kind !== 'machine') continue;
    const def = defForEntity(entity);
    if (!def) continue;
    for (let i = 0; i < def.snapPoints.length; i += 1) {
      const position = snapWorld(entity, i);
      if (!position) continue;
      const pick = pickOnRay(ray, position, CABLE_SNAP_RADIUS_M, CABLE_MAX_LENGTH_M);
      if (!pick) continue;
      const ref: SnapRef = { entityId: entity.id, snapIndex: i };
      if (requireFree && !snapFree(world, ref)) continue;
      if (
        !best ||
        pick.perp < best.pick.perp - 1e-6 ||
        (Math.abs(pick.perp - best.pick.perp) <= 1e-6 && pick.t < best.pick.t)
      ) {
        best = { ref, pick };
      }
    }
  }
  return best?.ref ?? null;
}

/** Nearest free platform top slot under the aim ray. */
export function findAimedSlot(world: World, playerId: EntityId, aim: ToolAim): SlotRef | null {
  const ray = aimRayFor(world, playerId, aim);
  const player = world.entities.get(playerId);
  if (!ray || !player?.planetId) return null;
  const planet = world.planets.find((p) => p.id === player.planetId);
  if (!planet) return null;
  let best: { ref: SlotRef; pick: RayPick } | null = null;
  for (const entity of world.entities.values()) {
    if (entity.planetId !== planet.id || entity.kind !== 'platform') continue;
    const def = defForEntity(entity);
    if (!def) continue;
    for (let i = 0; i < def.slots.length; i += 1) {
      const position = slotWorld(entity, i);
      if (!position) continue;
      const pick = pickOnRay(ray, position, SNAP_PLACE_RADIUS_M, CABLE_MAX_LENGTH_M);
      if (!pick) continue;
      const ref: SlotRef = { entityId: entity.id, slotIndex: i };
      if (!slotFree(world, ref)) continue;
      if (
        !best ||
        pick.perp < best.pick.perp - 1e-6 ||
        (Math.abs(pick.perp - best.pick.perp) <= 1e-6 && pick.t < best.pick.t)
      ) {
        best = { ref, pick };
      }
    }
  }
  return best?.ref ?? null;
}

/**
 * The snap/slot a placeable should use: platforms snap to a free rim point;
 * machines attach to a free top slot. Everything else is ground-placed.
 */
export function findPlacementTarget(
  world: World,
  playerId: EntityId,
  placeableId: string,
  aim: ToolAim,
): PlacementTarget | null {
  const def = placeableById(placeableId);
  if (!def) return null;
  if (def.entityKind === 'platform') {
    const snap = findAimedSnap(world, playerId, aim, true);
    return snap ? { snap } : null;
  }
  if (def.entityKind === 'machine' && def.machineType !== 'habitat') {
    const slot = findAimedSlot(world, playerId, aim);
    return slot ? { slot } : null;
  }
  // M14: a shuttle may stand on a platform's center pad or flat ground.
  if (def.entityKind === 'shuttle') {
    const slot = findAimedSlot(world, playerId, aim);
    return slot && slot.slotIndex === 0 ? { slot } : null;
  }
  return null;
}
