// Oxygen HUD assembly (M08): oxygen value, on-network flag, and
// compass-style hints to the habitat (when off-network) and the
// lost-backpack marker (until recovered). Pure read-only assembly; sim
// mutation still flows only through dispatch.

import { OXYGEN_MAX } from '../core/constants.js';
import { dot, normalize, sub, type Vec3d } from '../core/math.js';
import type { EntityId } from '../sim/entities.js';
import { moveBasis, upAt } from '../sim/physics/frames.js';
import type { World } from '../sim/world.js';
import { layerAt } from '../terrain/density.js';
import { isOnOxygenNetwork } from '../sim/systems/oxygen.js';
import { habitatsOn } from '../sim/systems/tethers.js';

export interface NavHint {
  /** "Habitat 45m" / "Pack 12m" (arrow added by the HUD). */
  label: string;
  distM: number;
  /** Bearing right of the player's facing, degrees in [-180, 180]. */
  bearingDeg: number;
}

export interface OxygenStatus {
  /** 0..OXYGEN_MAX (old saves report full via the lazy default). */
  oxygen: number;
  onNetwork: boolean;
  /** Mantle heat (M12): show the orange vignette while this layer is hot. */
  heat: boolean;
  /** Shown when off-network and a habitat exists. */
  habitat: NavHint | null;
  /** Shown while the lost-backpack marker waits. */
  deathMarker: NavHint | null;
}

/** Eight-way arrow for a bearing (0 = ahead, positive = right). */
export function arrowForBearing(bearingDeg: number): string {
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  const idx = Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8;
  return arrows[idx] as string;
}

function hintFor(world: World, playerId: EntityId, target: Vec3d, label: string): NavHint {
  const player = world.entities.get(playerId);
  const playerComp = player?.components.player;
  const planet = world.planets.find((p) => p.id === player?.planetId);
  const distM = player ? Math.hypot(target.x - player.position.x, target.y - player.position.y, target.z - player.position.z) : 0;
  let bearingDeg = 0;
  if (player && playerComp && planet) {
    const up = upAt(planet, player.position);
    const { forward, right } = moveBasis(up, playerComp.yaw, playerComp.pitch);
    const to = sub(target, player.position);
    const flat = sub(to, { x: up.x * dot(to, up), y: up.y * dot(to, up), z: up.z * dot(to, up) });
    if (dot(flat, flat) > 1e-6) {
      const n = normalize(flat);
      const fwd: Vec3d = normalize(sub(forward, { x: up.x * dot(forward, up), y: up.y * dot(forward, up), z: up.z * dot(forward, up) }));
      bearingDeg = (Math.atan2(dot(n, right), dot(n, fwd)) * 180) / Math.PI;
    }
  }
  return { label, distM, bearingDeg };
}

export function oxygenStatusFor(world: World, playerId: EntityId | null): OxygenStatus | null {
  if (!playerId) return null;
  const player = world.entities.get(playerId);
  if (!player || player.kind !== 'player') return null;
  const onNetwork = isOnOxygenNetwork(world, playerId);
  const oxygen = player.components.oxygen?.value ?? OXYGEN_MAX;
  let habitat: NavHint | null = null;
  if (!onNetwork && player.planetId) {
    const hub = habitatsOn(world, player.planetId)[0];
    if (hub) habitat = hintFor(world, playerId, hub.position, 'Habitat');
  }
  let deathMarker: NavHint | null = null;
  const markerId = player.components.player?.deathMarkerId;
  const marker = markerId ? world.entities.get(markerId) : undefined;
  if (marker) deathMarker = hintFor(world, playerId, marker.position, 'Pack');
  // Heat reads the same config data as the oxygen hazard, so the vignette
  // can never disagree with the drain (works on and off the tether network).
  let heat = false;
  const planet = world.planets.find((p) => p.id === player.planetId);
  if (planet) {
    const local = {
      x: player.position.x - planet.center.x,
      y: player.position.y - planet.center.y,
      z: player.position.z - planet.center.z,
    };
    heat = (layerAt(planet, local.x, local.y, local.z).hazardOxygenMult ?? 1) > 1;
  }
  return { oxygen, onNetwork, heat, habitat, deathMarker };
}
