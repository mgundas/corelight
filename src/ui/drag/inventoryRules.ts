// Inventory drag rules: pure functions, no React and no DOM. They decide
// whether a drag is allowed and which UI command (Action dispatch) applies.
// Unit-tested in tests/ui/inventoryRules.test.ts.

import type { DragSource } from '../stores/dragStore.js';
import type { UiCommands } from '../stores/commandsStore.js';

export type DragTarget =
  | { zone: 'bag'; index: number }
  | { zone: 'station'; stationId: string; index: number };

export interface InventoryRuleContext {
  /** Item id in a backpack slot (null = empty). */
  bagItemId(index: number): string | null;
  /** True when the station's recipes consume this item id. */
  stationAccepts(stationId: string, itemId: string): boolean;
  /** True when the station has a free input slot. */
  stationHasRoom(stationId: string): boolean;
}

export interface DragEvaluation {
  key: string;
  ok: boolean;
  label: string;
}

/** Parse a `data-drop` attribute: "bag:3" or "station:<id>:2". */
export function parseDropTarget(raw: string | null): DragTarget | null {
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts[0] === 'bag' && parts.length === 2) {
    const index = Number(parts[1]);
    if (Number.isInteger(index) && index >= 0) return { zone: 'bag', index };
    return null;
  }
  if (parts[0] === 'station' && parts.length === 3) {
    const index = Number(parts[2]);
    if (parts[1] && Number.isInteger(index) && index >= 0) {
      return { zone: 'station', stationId: parts[1], index };
    }
  }
  return null;
}

export function targetKey(target: DragTarget | null): string {
  if (!target) return 'outside';
  if (target.zone === 'bag') return `bag:${target.index}`;
  return `station:${target.stationId}:${target.index}`;
}

export function evaluateDrag(
  source: DragSource,
  target: DragTarget | null,
  ctx: InventoryRuleContext,
): DragEvaluation {
  const key = targetKey(target);
  const itemId = ctx.bagItemId(source.index);
  if (!itemId) return { key, ok: false, label: 'Slot is empty' };
  if (!target) return { key, ok: true, label: 'Drop to world' };
  if (target.zone === 'bag') {
    if (target.index === source.index) return { key, ok: false, label: 'Same slot' };
    const other = ctx.bagItemId(target.index);
    return { key, ok: true, label: other ? 'Swap' : 'Move here' };
  }
  if (!ctx.stationAccepts(target.stationId, itemId)) {
    return { key, ok: false, label: 'Station does not need this' };
  }
  if (!ctx.stationHasRoom(target.stationId)) {
    return { key, ok: false, label: 'Station inputs are full' };
  }
  return { key, ok: true, label: 'Load into station' };
}

/** Apply a validated drop by calling the Action-dispatch bridge. */
export function applyInventoryDrop(
  source: DragSource,
  target: DragTarget | null,
  commands: UiCommands,
): boolean {
  if (!target) {
    commands.dropSlot(source.index);
    return true;
  }
  if (target.zone === 'bag') {
    if (target.index === source.index) return false;
    commands.moveItem(source.index, target.index);
    return true;
  }
  commands.depositSlotToStation(target.stationId, source.index);
  return true;
}
