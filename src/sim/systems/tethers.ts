// Tether network system (M08): tethers relay oxygen when a chain of links
// reaches a habitat. Links form between tethers/habitats on the same planet
// within TETHER_RANGE_M with line of sight (density raymarch between post
// tips; solid runs under 0.5 m are ignored as pebbles, not walls).
//
// Cost control: the graph recomputes only when the topology changes
// (tethers/habitats added or removed) or when terrain edits land near
// existing posts. Edits far from every post leave the cached adjacency
// alone, so holding the dig button cannot cause frame drops. Nearby edits
// only re-test the pairs whose segment passes the edited chunk boxes.

import { TETHER_RANGE_M } from '../../core/constants.js';
import { events } from '../../core/events.js';
import { distance, lerp, type Vec3d } from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { createDensityField, type DensityField } from '../../terrain/density.js';
import { parseChunkKey } from '../../terrain/chunkKey.js';
import { chunkSizeForLevel } from '../../terrain/chunkKey.js';
import { nodeOrigin } from '../../terrain/octree.js';
import { upAt } from '../physics/frames.js';
import type { Entity, EntityId } from '../entities.js';
import type { World } from '../world.js';

/** Solid rock runs longer than this block a tether link (m). */
export const TETHER_OCCLUSION_M = 0.5;
/** Post tip height above the seated base (links + LOS run tip to tip). */
export const TETHER_TIP_HEIGHT_M = 0.9;
/** LOS march step along the segment (m). */
const LOS_STEP_M = 0.3;

const fieldCache = new WeakMap<World, Map<string, DensityField>>();

interface TetherGraphState {
  /** Sorted tether+habitat ids at the last full recompute. */
  lastIds: string;
  /** pairKey (minId|maxId) -> linked. Survives selective re-tests. */
  adj: Map<string, boolean>;
  /** LOD0 chunk keys edited since the last tick (drained per tick). */
  pendingEdits: Set<string>;
}

const stateCache = new WeakMap<World, TetherGraphState>();

function fieldFor(world: World, planet: PlanetConfig): DensityField {
  let perWorld = fieldCache.get(world);
  if (!perWorld) {
    perWorld = new Map();
    fieldCache.set(world, perWorld);
  }
  let field = perWorld.get(planet.id);
  if (!field) {
    field = createDensityField(planet, world.seed, (x, y, z) =>
      world.terrainEdits.deltaAt(planet, planet.id, x, y, z),
    );
    perWorld.set(planet.id, field);
  }
  return field;
}

function stateFor(world: World): TetherGraphState {
  let state = stateCache.get(world);
  if (!state) {
    state = { lastIds: '', adj: new Map(), pendingEdits: new Set() };
    stateCache.set(world, state);
    const ref = new WeakRef(world);
    events.on('terrainEdited', ({ keys }) => {
      const live = ref.deref();
      if (!live) return;
      const liveState = stateCache.get(live);
      if (!liveState) return;
      for (const key of keys) {
        try {
          if (parseChunkKey(key).level === 0) liveState.pendingEdits.add(key);
        } catch {
          // Malformed keys never match a chunk; ignore them.
        }
      }
    });
  }
  return state;
}

function pairKey(a: EntityId, b: EntityId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Post tip in planet-local coords (clears ground clutter at both ends). */
function tipLocal(planet: PlanetConfig, entity: Entity): Vec3d {
  const up = upAt(planet, entity.position);
  return {
    x: entity.position.x - planet.center.x + up.x * TETHER_TIP_HEIGHT_M,
    y: entity.position.y - planet.center.y + up.y * TETHER_TIP_HEIGHT_M,
    z: entity.position.z - planet.center.z + up.z * TETHER_TIP_HEIGHT_M,
  };
}

/**
 * True when a solid run longer than TETHER_OCCLUSION_M sits between the
 * tips. Marches the live (edited) density field; short runs are pebbles
 * and doorframes, not walls.
 */
export function segmentBlocked(
  field: DensityField,
  aLocal: Vec3d,
  bLocal: Vec3d,
): boolean {
  const dist = distance(aLocal, bLocal);
  if (dist < 1e-6) return false;
  const steps = Math.max(1, Math.ceil(dist / LOS_STEP_M));
  const stepLen = dist / steps;
  let solidRun = 0;
  for (let i = 0; i <= steps; i += 1) {
    const p = lerp(aLocal, bLocal, i / steps);
    if (field.density(p.x, p.y, p.z) > 0) {
      solidRun += stepLen;
      if (solidRun > TETHER_OCCLUSION_M) return true;
    } else {
      solidRun = 0;
    }
  }
  return false;
}

function linked(planet: PlanetConfig, field: DensityField, a: Entity, b: Entity): boolean {
  if (a.planetId !== planet.id || b.planetId !== planet.id) return false;
  if (distance(a.position, b.position) > TETHER_RANGE_M) return false;
  return !segmentBlocked(field, tipLocal(planet, a), tipLocal(planet, b));
}

function isRelay(entity: Entity): boolean {
  return (
    (entity.kind === 'tether' && entity.components.tether !== undefined) ||
    (entity.kind === 'machine' && entity.components.machine?.machineType === 'habitat')
  );
}

/** Shortest distance from a segment to an LOD0 chunk box (over-approximate). */
function segmentNearBox(a: Vec3d, b: Vec3d, min: Vec3d, size: number): boolean {
  const dist = distance(a, b);
  const steps = Math.max(1, Math.ceil(dist / 2));
  for (let i = 0; i <= steps; i += 1) {
    const p = lerp(a, b, i / steps);
    const over =
      p.x >= min.x - 2 &&
      p.x <= min.x + size + 2 &&
      p.y >= min.y - 2 &&
      p.y <= min.y + size + 2 &&
      p.z >= min.z - 2 &&
      p.z <= min.z + size + 2;
    if (over) return true;
  }
  return false;
}

/** All habitats on a planet (oxygen roots; M08 spawns exactly one). */
export function habitatsOn(world: World, planetId: string): Entity[] {
  const out: Entity[] = [];
  for (const entity of world.entities.values()) {
    if (
      entity.kind === 'machine' &&
      entity.planetId === planetId &&
      entity.components.machine?.machineType === 'habitat'
    ) {
      out.push(entity);
    }
  }
  return out;
}

/** Live tethers on a planet within range of a world position. */
export function liveTethersNear(world: World, planetId: string, pos: Vec3d, range: number): Entity[] {
  const out: Entity[] = [];
  for (const entity of world.entities.values()) {
    if (entity.kind !== 'tether' || entity.planetId !== planetId) continue;
    if (entity.components.tether?.live !== true) continue;
    if (distance(entity.position, pos) <= range) out.push(entity);
  }
  return out;
}

/** Rebuild the tether graph when the topology or nearby terrain changed. */
export function updateTethers(world: World, planets: PlanetConfig[]): void {
  const state = stateFor(world);
  const relays = [...world.entities.values()].filter(isRelay).sort((a, b) => (a.id < b.id ? -1 : 1));
  const idsKey = relays.map((e) => e.id).join('|');
  const topologyChanged = idsKey !== state.lastIds;

  if (!topologyChanged && state.pendingEdits.size === 0) return;

  if (topologyChanged) {
    // Full recompute: every pair on every planet, then drop stale pairs.
    const fresh = new Map<string, boolean>();
    for (const planet of planets) {
      const field = fieldFor(world, planet);
      const local = relays.filter((e) => e.planetId === planet.id);
      for (let i = 0; i < local.length; i += 1) {
        for (let j = i + 1; j < local.length; j += 1) {
          const a = local[i] as Entity;
          const b = local[j] as Entity;
          fresh.set(pairKey(a.id, b.id), linked(planet, field, a, b));
        }
      }
    }
    state.adj = fresh;
    state.lastIds = idsKey;
    state.pendingEdits.clear();
  } else {
    // Nearby edits only: re-test pairs whose segment passes an edited box.
    const planetOf = new Map(planets.map((p) => [p.id, p]));
    const byId = new Map(relays.map((e) => [e.id, e]));
    let anyNear = false;
    for (const key of state.pendingEdits) {
      let coord;
      let planetId: string;
      try {
        const parsed = parseChunkKey(key);
        coord = parsed.coord;
        planetId = parsed.planetId;
      } catch {
        continue;
      }
      const planet = planetOf.get(planetId);
      if (!planet) continue;
      const origin = nodeOrigin(planet, 0, coord);
      const worldMin = {
        x: origin.x + planet.center.x,
        y: origin.y + planet.center.y,
        z: origin.z + planet.center.z,
      };
      const size = chunkSizeForLevel(0);
      for (const pair of [...state.adj.keys()]) {
        const [aId, bId] = pair.split('|') as [EntityId, EntityId];
        const a = byId.get(aId);
        const b = byId.get(bId);
        if (!a || !b || a.planetId !== planet.id || b.planetId !== planet.id) continue;
        const aTip: Vec3d = {
          x: tipLocal(planet, a).x + planet.center.x,
          y: tipLocal(planet, a).y + planet.center.y,
          z: tipLocal(planet, a).z + planet.center.z,
        };
        const bTip: Vec3d = {
          x: tipLocal(planet, b).x + planet.center.x,
          y: tipLocal(planet, b).y + planet.center.y,
          z: tipLocal(planet, b).z + planet.center.z,
        };
        if (!segmentNearBox(aTip, bTip, worldMin, size)) continue;
        anyNear = true;
        state.adj.set(pair, linked(planet, fieldFor(world, planet), a, b));
      }
    }
    state.pendingEdits.clear();
    if (!anyNear) return;
  }

  // BFS liveness from every habitat over the cached adjacency.
  const neighbors = new Map<EntityId, EntityId[]>();
  for (const e of relays) neighbors.set(e.id, []);
  for (const [pair, isLinked] of state.adj) {
    if (!isLinked) continue;
    const [aId, bId] = pair.split('|') as [EntityId, EntityId];
    neighbors.get(aId)?.push(bId);
    neighbors.get(bId)?.push(aId);
  }
  const live = new Set<EntityId>();
  const queue: EntityId[] = [];
  for (const e of relays) {
    if (e.kind === 'machine') {
      live.add(e.id);
      queue.push(e.id);
    }
  }
  while (queue.length > 0) {
    const id = queue.pop() as EntityId;
    for (const next of neighbors.get(id) ?? []) {
      if (!live.has(next)) {
        live.add(next);
        queue.push(next);
      }
    }
  }
  for (const e of relays) {
    if (e.kind !== 'tether' || !e.components.tether) continue;
    e.components.tether.live = live.has(e.id);
    e.components.tether.links = (neighbors.get(e.id) ?? []).sort();
  }
}
