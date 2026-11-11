// World save format (ARCHITECTURE.md: Saving).
// WHY versioned JSON: the same shapes will later back network snapshots,
// so every field is validated on load and the version selects a migration.
// v1 stores: seed, clock, entity-ID counter, entities (plain data), and
// terrain edits as one base64 Float32 blob per chunk (flat [index, delta,
// index, delta, ...]; indices < 2^24 round-trip exactly through float32).

import type { Quat, Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import type { Entity, EntityId, EntityKind } from '../sim/entities.js';
import { TerrainEdits, type SerializedEdits } from '../terrain/edits.js';
import { parseChunkKey } from '../terrain/chunkKey.js';
import { World } from '../sim/world.js';

export const SAVE_VERSION = 1;

/** Version -> migration. Empty for now; M07+ adds entries when fields change. */
export const migrations: Record<number, (data: unknown) => unknown> = {};

const ENTITY_KINDS: ReadonlySet<string> = new Set<string>([
  'player',
  'item',
  'tether',
  'machine',
  'platform',
  'shuttle',
  'node',
  'sample',
  'engine',
  'lightstick',
  'marker',
]);

export interface SerializedEntity {
  id: EntityId;
  kind: EntityKind;
  planetId: string | null;
  position: Vec3d;
  rotation: Quat;
  components: Entity['components'];
}

export interface SaveData {
  version: 1;
  seed: number;
  /** Seconds of simulated time. */
  time: number;
  /** Entity-ID counter (keeps post-load nextId collision-free). */
  idCounter: number;
  entities: SerializedEntity[];
  /** LOD0 chunk key -> base64 little-endian Float32 [index, delta, ...]. */
  edits: Record<string, string>;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isVec3d(v: unknown): v is Vec3d {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return isFiniteNumber(r['x']) && isFiniteNumber(r['y']) && isFiniteNumber(r['z']);
}

function isQuat(v: unknown): v is Quat {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    isFiniteNumber(r['x']) &&
    isFiniteNumber(r['y']) &&
    isFiniteNumber(r['z']) &&
    isFiniteNumber(r['w'])
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  const buf = globalThis.Buffer;
  if (typeof buf !== 'undefined') return buf.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return btoa(binary);
}

function base64ToBytes(s: string): Uint8Array {
  const buf = globalThis.Buffer;
  if (typeof buf !== 'undefined') return new Uint8Array(buf.from(s, 'base64'));
  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Pairs -> base64 little-endian Float32 blob (one blob per chunk). */
function encodeChunk(entries: Array<[number, number]>): string {
  const buffer = new ArrayBuffer(entries.length * 2 * 4);
  const view = new DataView(buffer);
  entries.forEach(([index, delta], i) => {
    view.setFloat32(i * 8, index, true);
    view.setFloat32(i * 8 + 4, delta, true);
  });
  return bytesToBase64(new Uint8Array(buffer));
}

/** Base64 blob -> pairs (throws on malformed input). */
function decodeChunk(chunkKey: string, blob: string): Array<[number, number]> {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(blob);
  } catch {
    throw new Error(`bad save: chunk ${chunkKey} is not valid base64`);
  }
  if (bytes.length % 8 !== 0) throw new Error(`bad save: chunk ${chunkKey} has a torn float pair`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: Array<[number, number]> = [];
  for (let i = 0; i < bytes.length; i += 8) {
    const index = view.getFloat32(i, true);
    const delta = view.getFloat32(i + 4, true);
    if (!Number.isInteger(index) || !Number.isFinite(delta)) {
      throw new Error(`bad save: chunk ${chunkKey} has a malformed entry`);
    }
    entries.push([index, delta]);
  }
  return entries;
}

function serializeEntity(entity: Entity): SerializedEntity {
  const components = structuredClone(entity.components);
  // JSON cannot represent Infinity: a player that never hit hard rock stores
  // -Infinity ("never blocked"). Normalize to null on the way out and back
  // so the save stays plain-JSON while the sim keeps its sentinel.
  const player = components.player as { lastTooHard?: unknown } | undefined;
  if (player && !Number.isFinite(player.lastTooHard)) {
    player.lastTooHard = null;
  }
  return {
    id: entity.id,
    kind: entity.kind,
    planetId: entity.planetId,
    position: structuredClone(entity.position),
    rotation: structuredClone(entity.rotation),
    components,
  };
}

function deserializeEntity(data: unknown): Entity {
  if (typeof data !== 'object' || data === null) throw new Error('bad save: entity is not an object');
  const r = data as Record<string, unknown>;
  if (typeof r['id'] !== 'string' || r['id'].length === 0) throw new Error('bad save: entity id missing');
  if (typeof r['kind'] !== 'string' || !ENTITY_KINDS.has(r['kind'])) {
    throw new Error(`bad save: unknown entity kind ${String(r['kind'])}`);
  }
  if (r['planetId'] !== null && typeof r['planetId'] !== 'string') {
    throw new Error('bad save: entity planetId must be a string or null');
  }
  if (!isVec3d(r['position'])) throw new Error('bad save: entity position malformed');
  if (!isQuat(r['rotation'])) throw new Error('bad save: entity rotation malformed');
  if (typeof r['components'] !== 'object' || r['components'] === null) {
    throw new Error('bad save: entity components missing');
  }
  const components = structuredClone(r['components']) as Entity['components'];
  // Inverse of the serialize normalization: null JSON "never" -> -Infinity.
  const player = components.player as { lastTooHard?: unknown } | undefined;
  if (player && player.lastTooHard === null) {
    player.lastTooHard = Number.NEGATIVE_INFINITY;
  }
  return {
    id: r['id'],
    kind: r['kind'] as EntityKind,
    planetId: r['planetId'],
    position: { ...r['position'] },
    rotation: { ...r['rotation'] },
    components,
  };
}

export function serializeWorld(world: World): SaveData {
  const raw = world.terrainEdits.serialize();
  const edits: Record<string, string> = {};
  for (const [key, entries] of Object.entries(raw.chunks)) {
    if (entries.length > 0) edits[key] = encodeChunk(entries);
  }
  return {
    version: SAVE_VERSION,
    seed: world.seed,
    time: world.time,
    idCounter: world.getIdCounter(),
    entities: [...world.entities.values()].map(serializeEntity),
    edits,
  };
}

export function deserializeWorld(data: unknown, planets: PlanetConfig[]): World {
  if (typeof data !== 'object' || data === null) throw new Error('bad save: not an object');
  const root = data as Record<string, unknown>;
  const version = root['version'];
  if (version !== SAVE_VERSION) {
    const migrate = typeof version === 'number' ? migrations[version] : undefined;
    if (!migrate) throw new Error(`bad save: unsupported version ${String(version)}`);
    return deserializeWorld(migrate(data), planets);
  }
  if (!isFiniteNumber(root['seed'])) throw new Error('bad save: seed missing');
  if (!isFiniteNumber(root['time'])) throw new Error('bad save: time missing');
  if (!Number.isInteger(root['idCounter'])) throw new Error('bad save: idCounter missing');
  if (!Array.isArray(root['entities'])) throw new Error('bad save: entities missing');
  if (typeof root['edits'] !== 'object' || root['edits'] === null) {
    throw new Error('bad save: edits missing');
  }
  const seed: number = root['seed'];
  const time: number = root['time'];
  const idCounter: number = root['idCounter'] as number;
  const world = new World(seed, {
    planets,
    time,
    idCounter,
  });
  for (const raw of root['entities']) {
    const entity = deserializeEntity(raw);
    if (world.entities.has(entity.id)) throw new Error(`bad save: duplicate entity ${entity.id}`);
    world.entities.set(entity.id, entity);
  }
  // Edits ride the validated TerrainEdits path: base64 -> pairs -> the same
  // deserialize() the live game uses, so a corrupt blob fails loudly here
  // instead of warping terrain after load.
  const chunks: SerializedEdits['chunks'] = {};
  for (const [key, blob] of Object.entries(root['edits'] as Record<string, unknown>)) {
    parseChunkKey(key);
    if (typeof blob !== 'string') throw new Error(`bad save: chunk ${key} is not a string`);
    chunks[key] = decodeChunk(key, blob);
  }
  world.terrainEdits.copyFrom(TerrainEdits.deserialize({ version: 1, chunks }));
  return world;
}
