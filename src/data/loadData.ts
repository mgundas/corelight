// Game content data: items live in JSON (ARCHITECTURE.md hard rule 8),
// validated at load with clear errors. Adding an item needs no code change
// beyond its behavior: sim/render look definitions up by canonical id.

import rawItems from './items.json' with { type: 'json' };

export type ItemShape = 'cube' | 'sphere' | 'crystal' | 'capsule' | 'canister' | 'crate';
export type ItemSize = 'small' | 'medium' | 'large';

export interface ItemLight {
  color: string;
  intensity: number;
}

export interface ItemDef {
  id: string;
  name: string;
  color: string;
  shape: ItemShape;
  size: ItemSize;
  stackable: boolean;
  emitsLight?: ItemLight;
}

const SHAPES: ReadonlySet<string> = new Set(['cube', 'sphere', 'crystal', 'capsule', 'canister', 'crate']);
const SIZES: ReadonlySet<string> = new Set(['small', 'medium', 'large']);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Validate one raw entry; throws a clear error naming the bad field. */
export function parseItemDef(data: unknown): ItemDef {
  if (!isRecord(data)) throw new Error('bad item: entry is not an object');
  const { id, name, color, shape, size, stackable, emitsLight } = data;
  if (typeof id !== 'string' || !/^[a-z0-9_]+$/.test(id)) {
    throw new Error(`bad item: id must be lowercase snake_case, got ${String(id)}`);
  }
  if (typeof name !== 'string' || name.length === 0) throw new Error(`bad item ${id}: name missing`);
  if (typeof color !== 'string' || !HEX_COLOR.test(color)) {
    throw new Error(`bad item ${id}: color must be a #rrggbb hex string`);
  }
  if (typeof shape !== 'string' || !SHAPES.has(shape)) {
    throw new Error(`bad item ${id}: shape must be one of cube|sphere|crystal|capsule|canister`);
  }
  if (typeof size !== 'string' || !SIZES.has(size)) {
    throw new Error(`bad item ${id}: size must be one of small|medium|large`);
  }
  if (typeof stackable !== 'boolean') throw new Error(`bad item ${id}: stackable must be a boolean`);
  let light: ItemLight | undefined;
  if (emitsLight !== undefined) {
    if (!isRecord(emitsLight)) throw new Error(`bad item ${id}: emitsLight must be an object`);
    if (typeof emitsLight['color'] !== 'string' || !HEX_COLOR.test(emitsLight['color'] as string)) {
      throw new Error(`bad item ${id}: emitsLight.color must be a #rrggbb hex string`);
    }
    if (typeof emitsLight['intensity'] !== 'number' || !Number.isFinite(emitsLight['intensity'])) {
      throw new Error(`bad item ${id}: emitsLight.intensity must be a finite number`);
    }
    light = { color: emitsLight['color'] as string, intensity: emitsLight['intensity'] as number };
  }
  return {
    id,
    name,
    color,
    shape: shape as ItemShape,
    size: size as ItemSize,
    stackable,
    ...(light ? { emitsLight: light } : {}),
  };
}

/** Validate a raw JSON array into a definition list (duplicate ids throw). */
export function loadItems(data: unknown): ItemDef[] {
  if (!Array.isArray(data)) throw new Error('bad items.json: top level must be an array');
  const defs = data.map(parseItemDef);
  const seen = new Set<string>();
  for (const def of defs) {
    if (seen.has(def.id)) throw new Error(`bad items.json: duplicate id ${def.id}`);
    seen.add(def.id);
  }
  return defs;
}

/** Validated catalog, loaded once at startup (throws loudly on bad data). */
export const ITEMS: ItemDef[] = loadItems(rawItems as unknown[]);

const byId = new Map<string, ItemDef>(ITEMS.map((def) => [def.id, def]));

/** Look a definition up by canonical id (throws on unknown ids). */
export function itemDef(id: string): ItemDef {
  const def = byId.get(id);
  if (!def) throw new Error(`unknown item id: ${id}`);
  return def;
}

/** True for ids the catalog defines (lets the sim reject bad spawns). */
export function isKnownItem(id: string): boolean {
  return byId.has(id);
}
