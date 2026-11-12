// Power network graph (M10). Membership changes only when structures,
// cables or attachments change, so the full BFS is cached under a topology
// key (the tether graph uses the same cost-control pattern). Generation,
// demand and storage are recomputed every tick from the cached members.
//
// Connections: cables join their two snap points, edge-snapped platforms are
// joined by `placeable.snappedTo`, and machines on platform slots are joined
// by `placeable.attachedTo`. Isolated machines/platforms still form a
// one-member network (a standalone printer simply has no generation).

import { BATTERY_CAPACITY, HABITAT_CAPACITY } from '../core/constants.js';
import type { Entity, EntityId } from './entities.js';
import type { World } from './world.js';

export interface PowerNetwork {
  /** Stable within one topology: net_<planet>_<min member id>. */
  id: string;
  planetId: string;
  /** Sorted by entity id for deterministic priority walk order. */
  members: Entity[];
}

/** Lazily heal one power component (system/action paths only). */
export function ensurePower(entity: Entity): Entity['components']['power'] {
  let power = entity.components.power;
  if (!power) {
    power = { stored: 0, capacity: 0, paused: false, networkId: null };
    entity.components.power = power;
  }
  const machineType = entity.components.machine?.machineType;
  const capacity =
    machineType === 'battery' ? BATTERY_CAPACITY : machineType === 'habitat' ? HABITAT_CAPACITY : 0;
  // Capacity is catalog-derived, never progression: changing item data must
  // not leave a stale save with the wrong battery size.
  power.capacity = capacity;
  if (!Number.isFinite(power.stored)) power.stored = 0;
  power.stored = Math.min(capacity, Math.max(0, power.stored));
  if (typeof power.paused !== 'boolean') power.paused = false;
  if (power.networkId === undefined) power.networkId = null;
  return power;
}

function isMember(entity: Entity): boolean {
  return (entity.kind === 'machine' || entity.kind === 'platform') && entity.planetId !== null;
}

/** Topology key: members + every connection reference. */
export function powerTopologyKey(world: World): string {
  const parts: string[] = [];
  for (const entity of world.entities.values()) {
    if (!isMember(entity)) continue;
    const p = entity.components.placeable;
    parts.push(
      [
        'm',
        entity.id,
        entity.planetId ?? '',
        p?.attachedTo ?? '',
        p?.attachedSlot ?? '',
        p?.snappedTo ?? '',
        p?.snappedToSnap ?? '',
        p?.snappedOwnSnap ?? '',
      ].join(':'),
    );
  }
  for (const entity of world.entities.values()) {
    if (entity.kind !== 'cable') continue;
    const cable = entity.components.cable;
    if (!cable) continue;
    parts.push(
      `c:${entity.id}:${cable.a.entityId}:${cable.a.snapIndex}:${cable.b.entityId}:${cable.b.snapIndex}`,
    );
  }
  parts.sort();
  return parts.join('|');
}

/** Full graph rebuild (pure; the caller usually uses the cache below). */
export function buildPowerNetworks(world: World): PowerNetwork[] {
  const members = [...world.entities.values()].filter(isMember);
  const byId = new Map<EntityId, Entity>(members.map((e) => [e.id, e]));
  const neighbors = new Map<EntityId, EntityId[]>();
  for (const member of members) neighbors.set(member.id, []);
  const connect = (a: EntityId | null | undefined, b: EntityId | null | undefined): void => {
    if (!a || !b || a === b) return;
    const entityA = byId.get(a);
    const entityB = byId.get(b);
    if (!entityA || !entityB) return;
    // A malformed cross-planet reference can never conduct power.
    if (entityA.planetId !== entityB.planetId) return;
    neighbors.get(a)?.push(b);
    neighbors.get(b)?.push(a);
  };
  for (const entity of world.entities.values()) {
    if (entity.kind === 'cable') {
      const cable = entity.components.cable;
      if (cable) connect(cable.a.entityId, cable.b.entityId);
    } else if (entity.kind === 'platform') {
      connect(entity.id, entity.components.placeable?.snappedTo);
    } else if (entity.kind === 'machine') {
      connect(entity.id, entity.components.placeable?.attachedTo);
    }
  }
  const seen = new Set<EntityId>();
  const networks: PowerNetwork[] = [];
  for (const member of members) {
    if (seen.has(member.id)) continue;
    const queue: EntityId[] = [member.id];
    seen.add(member.id);
    const group: Entity[] = [];
    while (queue.length > 0) {
      const id = queue.pop() as EntityId;
      const entity = byId.get(id);
      if (entity) group.push(entity);
      for (const next of neighbors.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    group.sort((a, b) => (a.id < b.id ? -1 : 1));
    const minId = group[0]?.id ?? member.id;
    const planetId = group[0]?.planetId ?? member.planetId ?? '';
    networks.push({ id: `net_${planetId}_${minId}`, planetId, members: group });
  }
  networks.sort((a, b) => (a.id < b.id ? -1 : 1));
  return networks;
}

const networkCache = new WeakMap<World, { key: string; networks: PowerNetwork[] }>();

/** Cached networks; rebuilds only when the topology key changes. */
export function powerNetworksFor(world: World): PowerNetwork[] {
  const key = powerTopologyKey(world);
  const cached = networkCache.get(world);
  if (cached && cached.key === key) return cached.networks;
  const networks = buildPowerNetworks(world);
  networkCache.set(world, { key, networks });
  return networks;
}
