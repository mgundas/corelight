// Placeable catalog (M09): printed objects that are carried as packaged
// items and placed in the world. JSON is the only place content is defined
// (ARCHITECTURE.md hard rule 8); the renderer selects a procedural model by
// the validated `model` string. Snap points are local to the model origin
// (base at ground level) and feed cable placement in M10.

import rawPlaceables from './placeables.json' with { type: 'json' };
import { isKnownItem } from './loadData.js';

export type PlaceableSize = 'small' | 'medium' | 'large';
export type PlaceableEntityKind = 'platform' | 'machine' | 'shuttle';
export type PlaceableModel =
  | 'platform'
  | 'printer_small'
  | 'panel'
  | 'battery'
  | 'furnace'
  | 'station'
  | 'printer_medium'
  | 'refinery'
  | 'shuttle'
  | 'habitat'
  | 'lightstick';

const SIZES: ReadonlySet<string> = new Set(['small', 'medium', 'large']);
const ENTITY_KINDS: ReadonlySet<string> = new Set(['platform', 'machine', 'shuttle']);
const MODELS: ReadonlySet<string> = new Set([
  'platform',
  'printer_small',
  'panel',
  'battery',
  'furnace',
  'station',
  'printer_medium',
  'refinery',
  'shuttle',
  'habitat',
  'lightstick',
]);

export interface SnapPoint {
  x: number;
  y: number;
  z: number;
}

export interface PlaceableDef {
  id: string;
  name: string;
  size: PlaceableSize;
  /** Packaged item id carried before placement (from items.json). */
  packageItem: string;
  entityKind: PlaceableEntityKind;
  /** Machine component type (null for platforms and shuttles). */
  machineType: string | null;
  /** Procedural model selector for render/views/placeableView.ts. */
  model: PlaceableModel;
  footprintRadiusM: number;
  heightM: number;
  /** Local-space cable snap points (M10 consumes these). */
  snapPoints: SnapPoint[];
  description: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseSnapPoint(data: unknown, id: string, index: number): SnapPoint {
  if (!isRecord(data)) throw new Error(`bad placeable ${id}: snapPoints[${index}] must be an object`);
  const { x, y, z } = data;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof z !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  ) {
    throw new Error(`bad placeable ${id}: snapPoints[${index}] needs finite x/y/z`);
  }
  return { x, y, z };
}

/** Validate one raw entry; throws a clear error naming the bad field. */
export function parsePlaceableDef(data: unknown): PlaceableDef {
  if (!isRecord(data)) throw new Error('bad placeable: entry is not an object');
  const { id, name, size, packageItem, entityKind, machineType, model, footprintRadiusM, heightM, snapPoints, description } = data;
  if (typeof id !== 'string' || !/^[a-z0-9_]+$/.test(id)) {
    throw new Error(`bad placeable: id must be lowercase snake_case, got ${String(id)}`);
  }
  if (typeof name !== 'string' || name.length === 0) throw new Error(`bad placeable ${id}: name missing`);
  if (typeof size !== 'string' || !SIZES.has(size)) {
    throw new Error(`bad placeable ${id}: size must be one of small|medium|large`);
  }
  if (typeof packageItem !== 'string' || !isKnownItem(packageItem)) {
    throw new Error(`bad placeable ${id}: packageItem must be a known item id`);
  }
  if (typeof entityKind !== 'string' || !ENTITY_KINDS.has(entityKind)) {
    throw new Error(`bad placeable ${id}: entityKind must be one of platform|machine|shuttle`);
  }
  if (machineType !== null && (typeof machineType !== 'string' || !/^[a-z0-9_]+$/.test(machineType))) {
    throw new Error(`bad placeable ${id}: machineType must be null or lowercase snake_case`);
  }
  if (typeof model !== 'string' || !MODELS.has(model)) {
    throw new Error(`bad placeable ${id}: unknown model ${String(model)}`);
  }
  if (typeof footprintRadiusM !== 'number' || !Number.isFinite(footprintRadiusM) || footprintRadiusM <= 0) {
    throw new Error(`bad placeable ${id}: footprintRadiusM must be a positive number`);
  }
  if (typeof heightM !== 'number' || !Number.isFinite(heightM) || heightM <= 0) {
    throw new Error(`bad placeable ${id}: heightM must be a positive number`);
  }
  if (!Array.isArray(snapPoints)) throw new Error(`bad placeable ${id}: snapPoints must be an array`);
  if (typeof description !== 'string' || description.length === 0) {
    throw new Error(`bad placeable ${id}: description missing`);
  }
  return {
    id,
    name,
    size: size as PlaceableSize,
    packageItem,
    entityKind: entityKind as PlaceableEntityKind,
    machineType: machineType as string | null,
    model: model as PlaceableModel,
    footprintRadiusM,
    heightM,
    snapPoints: snapPoints.map((point, i) => parseSnapPoint(point, id, i)),
    description,
  };
}

/** Validate a raw JSON array into a definition list (duplicate ids throw). */
export function loadPlaceables(data: unknown): PlaceableDef[] {
  if (!Array.isArray(data)) throw new Error('bad placeables.json: top level must be an array');
  const defs = data.map(parsePlaceableDef);
  const seen = new Set<string>();
  for (const def of defs) {
    if (seen.has(def.id)) throw new Error(`bad placeables.json: duplicate id ${def.id}`);
    seen.add(def.id);
  }
  return defs;
}

/** Validated catalog, loaded once at startup (throws loudly on bad data). */
export const PLACEABLES: PlaceableDef[] = loadPlaceables(rawPlaceables as unknown[]);

const byId = new Map<string, PlaceableDef>(PLACEABLES.map((def) => [def.id, def]));
const byPackage = new Map<string, PlaceableDef>(PLACEABLES.map((def) => [def.packageItem, def]));
const byMachineType = new Map<string, PlaceableDef>(
  PLACEABLES.filter((def) => def.machineType !== null).map((def) => [def.machineType as string, def]),
);

/** Look a definition up by id (throws on unknown ids). */
export function placeableDef(id: string): PlaceableDef {
  const def = byId.get(id);
  if (!def) throw new Error(`unknown placeable id: ${id}`);
  return def;
}

/** Non-throwing lookup for render/UI data that may outlive a catalog edit. */
export function placeableById(id: string): PlaceableDef | undefined {
  return byId.get(id);
}

/** True for ids the catalog defines. */
export function isPlaceable(id: string): boolean {
  return byId.has(id);
}

/** Resolve the placeable a packaged item unpacks into, if any. */
export function placeableForPackageItem(itemId: string): PlaceableDef | undefined {
  return byPackage.get(itemId);
}

/** Resolve the placeable a machine component type belongs to. */
export function placeableForMachineType(machineType: string): PlaceableDef | undefined {
  return byMachineType.get(machineType);
}
