import type { Quat, Vec3d } from '../core/math.js';

export type EntityId = string;

export type EntityKind =
  | 'player'
  | 'item'
  | 'tether'
  | 'machine'
  | 'platform'
  | 'shuttle'
  | 'node'
  | 'sample'
  | 'engine'
  | 'lightstick'
  | 'marker'
  | 'cable';

// Component stubs. Later milestones fill these with real fields.
export interface Components {
  oxygen: OxygenComponent;
  inventory: InventoryComponent;
  power: PowerComponent;
  printer: PrinterComponent;
  furnace: FurnaceComponent;
  player: PlayerComponent;
  item: ItemComponent;
  node: NodeComponent;
  tether: TetherComponent;
  machine: MachineComponent;
  placeable: PlaceableComponent;
  cable: CableComponent;
  sample: SampleComponent;
  research: ResearchComponent;
  shuttle: ShuttleComponent;
}

export interface OxygenComponent {
  value: number;
}

export interface InventoryComponent {
  slots: (EntityId | null)[];
  /** Selected slot index (0-based, drives drag/drop + HUD highlight). */
  selectedSlot: number;
}

/**
 * Power network member (M10). Storage lives on batteries and habitats;
 * `paused` is set for working machines the network cannot afford. The
 * network totals are a per-tick HUD projection written by the power system.
 */
export interface PowerComponent {
  stored: number;
  capacity: number;
  paused: boolean;
  networkId: string | null;
  generation?: number;
  demand?: number;
  networkStored?: number;
  networkCapacity?: number;
}

/** Printing job state for a station machine (M09). */
export interface PrinterComponent {
  /** Active recipe id, or null when idle. */
  recipeId: string | null;
  /** Seconds of progress into the active recipe. */
  progressS: number;
  /** Item entity ids loaded into the station's input slots. */
  inputs: EntityId[];
  /** Finished output waiting for pickup (recipe output id), or null. */
  outputReady: string | null;
  /**
   * Furnace biomass boost (M12): true when the active job consumed a fuel
   * biomass and advances at FUEL_BOOST_MULT. Optional so pre-M12 saves and
   * hand-made test stations stay valid (absent reads as unboosted).
   */
  boosted?: boolean;
}

export interface FurnaceComponent {
  progress: number;
}

/** A physical pickup in the world (ground) or carried in a backpack. */
export interface ItemComponent {
  /** Canonical id from src/data/items.json. */
  itemId: string;
  /** Player entity id holding this item, if any (carried items skip physics). */
  holder?: EntityId;
  /** Player entity id grab-carrying this item (cursor mode). */
  grabbedBy?: EntityId;
  /**
   * Data value of a research sample (M11). Node-mined samples carry their
   * origin value here; dedicated sample pods also store it in `sample`.
   * Missing on old M07 saves, which read as crust value.
   */
  sampleValue?: number;
}

/** A tether post: oxygen relay when live (connected back to a habitat). */
export interface TetherComponent {
  /** True when a chain of links reaches a habitat (recomputed by the system). */
  live: boolean;
  /** Entity ids this tether draws cables to (habitats + tethers). */
  links: EntityId[];
}

/** A base machine. Habitats are oxygen roots; the rest are M09 stations. */
export type MachineType =
  | 'habitat'
  | 'small_printer'
  | 'medium_printer'
  | 'solar_panel'
  | 'battery'
  | 'furnace'
  | 'research_station'
  | 'refinery';

export interface MachineComponent {
  machineType: MachineType;
}

/** Places an entity back to its data catalog entry (M09 placeables). */
export interface PlaceableComponent {
  placeableId: string;
  /** Machine attached to a platform top slot (M10). */
  attachedTo?: EntityId | null;
  attachedSlot?: number;
  /** Platform edge-snapped to another platform (M10). */
  snappedTo?: EntityId | null;
  /** Snap index used on the target platform. */
  snappedToSnap?: number;
  /** Snap index used on this platform (its own side of the join). */
  snappedOwnSnap?: number;
}

/** One catalog snap point on an entity (cable endpoint). */
export interface SnapRef {
  entityId: EntityId;
  snapIndex: number;
}

/** One platform top slot (machine attachment). */
export interface SlotRef {
  entityId: EntityId;
  slotIndex: number;
}

/** A cable entity: two snap points joined by a sagging line (M10). */
export interface CableComponent {
  a: SnapRef;
  b: SnapRef;
}
/** A mineable resource deposit placed deterministically per LOD0 chunk. */
export interface NodeComponent {
  /** Canonical resource id (item spawned per charge). */
  resourceId: string;
  /** Remaining charges (2 to 5 at spawn; 0 depletes and removes the node). */
  charges: number;
  maxCharges: number;
  /** LOD0 chunk key this node was placed from (respawn bookkeeping). */
  chunkKey: string;
}

/** A glowing research pod (kind 'sample') placed deterministically per chunk. */
export interface SampleComponent {
  /** Data value when processed (10 crust / 20 mantle / 40 core). */
  value: number;
  /** LOD0 chunk key this pod was placed from (respawn bookkeeping). */
  chunkKey: string;
}

/** Research station job (M11): one sample in, Data out. */
export interface ResearchComponent {
  /** Sample entity currently being analyzed, or null. */
  inputId: EntityId | null;
  /** Seconds of analysis progress. */
  progressS: number;
  /** Finished Data waiting for collection. */
  dataReady: number;
}

/** One-shot movement intent for the current tick (cleared when consumed). */
export interface PlayerInputState {
  /** Strafe right (+x) / left (-x), each in [-1, 1]. */
  moveX: number;
  /** Forward (+z) / back (-z), each in [-1, 1]. */
  moveZ: number;
  jump: boolean;
  sprint: boolean;
}

/**
 * One-tick flight intent (M14). All values come from `shuttleInput` Actions,
 * so a future co-op server runs the identical vehicle model. `lookYaw` and
 * `lookPitch` are absolute steering angles in the current up basis (the mouse
 * look), while `yawRate` is the A/D nudge applied on top for this tick.
 */
export interface ShuttleInputState {
  /** W/S: +1 forward, -1 reverse, 0 idle. */
  thrust: number;
  /** A/D: -1 left, +1 right, 0 idle. */
  yawRate: number;
  /** Space held (launch charge / upward thrust). */
  lift: boolean;
  /** Shift held (speed cap boost). */
  boost: boolean;
  lookYaw: number;
  lookPitch: number;
}

/** Shuttle flight state (M14). Positions stay in the entity, not here. */
export interface ShuttleComponent {
  /** Loaded fuel cells (0..SHUTTLE_FUEL_MAX). */
  fuel: number;
  /** Piloting player entity id, or null when parked. */
  pilotId: EntityId | null;
  /** World-frame velocity in m/s (the arcade state driving the body). */
  velocity: Vec3d;
  /** Steering angles in the current up basis. */
  yaw: number;
  pitch: number;
  /**
   * Basis "up" used to build the flight orientation. Kept through deep space
   * (where there is no planet) so the ship never snaps when the SOI changes;
   * inside an SOI it eases toward the radial up (auto-orient).
   */
  up: Vec3d;
  /** Seconds Space has been held for launch (reset on release). */
  launchChargeS: number;
  /** Last absolute mouse-look yaw, so A/D steering can accumulate. */
  lastLookYaw?: number;
  /** False while resting on its legs; true once launched. */
  airborne: boolean;
  /** Latest shuttleInput, consumed once per tick by the shuttle system. */
  input: ShuttleInputState | null;
}

export interface PlayerComponent {
  /** World-frame velocity in m/s (vertical part is gravity-integrated). */
  velocity: Vec3d;
  grounded: boolean;
  /** Look orientation: yaw around local up, pitch up/down (radians). */
  yaw: number;
  pitch: number;
  /** Latest input, consumed once per tick by the physics system. */
  input: PlayerInputState | null;
  /** Seconds the capsule center has spent inside solid terrain. */
  embeddedTime: number;
  /** Sticky escape mode: once gradient descent proves fruitless, the safety
   * keeps plowing surface-ward through thin dips until clearly free. */
  escaping: boolean;
  /** Loose soil carried for the terrain tool's add mode (max SOIL_MAX). */
  soil: number;
  /** Drill tier: edits only affect samples with layer hardness <= this. */
  toolHardness: number;
  /** World time of the last hardness-blocked edit (drives the indicator). */
  lastTooHard: number;
  /** Helmet lamp on/off (L key). Part of player state, renders a SpotLight. */
  headlampOn: boolean;
  /** Lost-backpack marker entity from the last death (null when recovered). */
  deathMarkerId: EntityId | null;
  /**
   * Large packaged placeable carried in front of the player (null = none).
   * Optional so pre-M09 saves (and their lazy component heals) stay valid.
   */
  carryingLarge?: EntityId | null;
  /** Item levitating in front of the player during grab-carry (cursor mode). */
  grabbed?: EntityId | null;
  /** Shuttle currently piloted (M14); missing/undefined = on foot. */
  pilotingShuttleId?: EntityId | null;
  /** Last habitat the player stood near (M14 respawn point). */
  lastHabitatId?: EntityId | null;
}

export interface Entity {
  id: EntityId;
  kind: EntityKind;
  /** Planet id, or null when in space. */
  planetId: string | null;
  /** World-space doubles. */
  position: Vec3d;
  rotation: Quat;
  components: Partial<Components>;
}

/**
 * True for entities that behave like a carried/loose item: regular items and
 * research sample pods (kind 'sample' with an item component). Samples stay
 * distinct for their own deterministic streaming/render view while sharing
 * the pickup, drop, grab and item-physics paths.
 */
export function isItemLike(entity: Entity | undefined): boolean {
  return (
    entity !== undefined &&
    (entity.kind === 'item' || entity.kind === 'sample') &&
    entity.components.item !== undefined
  );
}
