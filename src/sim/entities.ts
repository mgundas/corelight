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
}

export interface OxygenComponent {
  value: number;
}

export interface InventoryComponent {
  slots: (EntityId | null)[];
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
