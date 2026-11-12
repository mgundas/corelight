// Terrain tool equip state (input/presentation, not World state). The tool
// is OFF by default: Q equips it, X toggles dig <-> add while equipped.
// LMB applies the active brush; with the tool off LMB is grab-carry.

export type BrushMode = 'dig' | 'add';

export class ToolMode {
  active = false;
  brush: BrushMode = 'dig';

  toggle(): void {
    this.active = !this.active;
  }

  toggleBrush(): void {
    this.brush = this.brush === 'dig' ? 'add' : 'dig';
  }

  cancel(): void {
    this.active = false;
  }
}
