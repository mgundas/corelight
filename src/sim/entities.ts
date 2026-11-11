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
  | 'marker';

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
}

export interface OxygenComponent {
  value: number;
}

export interface InventoryComponent {
  slots: (EntityId | null)[];
  /** Selected slot index (0-based, drives the Q drop + HUD highlight). */
  selectedSlot: number;
}

export interface PowerComponent {
  stored: number;
}

export interface PrinterComponent {
  recipeId: string | null;
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

/** One-shot movement intent for the current tick (cleared when consumed). */
export interface PlayerInputState {
  /** Strafe right (+x) / left (-x), each in [-1, 1]. */
  moveX: number;
  /** Forward (+z) / back (-z), each in [-1, 1]. */
  moveZ: number;
  jump: boolean;
  sprint: boolean;
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
