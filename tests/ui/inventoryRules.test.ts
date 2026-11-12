// Inventory drag rules: pure evaluate/apply logic (no DOM, no React).
// Covers reorder, swap, drag-out-to-world and station deposits.

import { describe, expect, it } from 'vitest';
import {
  applyInventoryDrop,
  evaluateDrag,
  parseDropTarget,
  targetKey,
  type InventoryRuleContext,
} from '../../src/ui/drag/inventoryRules.js';
import type { UiCommands } from '../../src/ui/stores/commandsStore.js';

function context(overrides: Partial<InventoryRuleContext> = {}): InventoryRuleContext {
  return {
    bagItemId: (index) => (index === 0 ? 'resin' : index === 1 ? 'silicate' : null),
    stationAccepts: () => true,
    stationHasRoom: () => true,
    ...overrides,
  };
}

describe('inventory drag rules', () => {
  it('parses data-drop keys and rejects malformed ones', () => {
    expect(parseDropTarget('bag:3')).toEqual({ zone: 'bag', index: 3 });
    expect(parseDropTarget('station:machine_x:2')).toEqual({
      zone: 'station',
      stationId: 'machine_x',
      index: 2,
    });
    expect(parseDropTarget('bag:-1')).toBeNull();
    expect(parseDropTarget('bag:abc')).toBeNull();
    expect(parseDropTarget('station::1')).toBeNull();
    expect(parseDropTarget(null)).toBeNull();
    expect(targetKey(null)).toBe('outside');
  });

  it('moves into an empty slot and swaps with an occupied one', () => {
    const ctx = context();
    expect(evaluateDrag({ zone: 'bag', index: 0 }, { zone: 'bag', index: 2 }, ctx)).toEqual({
      key: 'bag:2',
      ok: true,
      label: 'Move here',
    });
    expect(evaluateDrag({ zone: 'bag', index: 0 }, { zone: 'bag', index: 1 }, ctx)).toEqual({
      key: 'bag:1',
      ok: true,
      label: 'Swap',
    });
    expect(evaluateDrag({ zone: 'bag', index: 0 }, { zone: 'bag', index: 0 }, ctx).ok).toBe(false);
  });

  it('drops to the world only when the source still holds an item', () => {
    expect(evaluateDrag({ zone: 'bag', index: 0 }, null, context()).ok).toBe(true);
    expect(
      evaluateDrag(
        { zone: 'bag', index: 5 },
        null,
        context({ bagItemId: () => null }),
      ).ok,
    ).toBe(false);
  });

  it('validates station acceptance and room', () => {
    const target = { zone: 'station' as const, stationId: 's1', index: 0 };
    expect(evaluateDrag({ zone: 'bag', index: 0 }, target, context())).toEqual({
      key: 'station:s1:0',
      ok: true,
      label: 'Load into station',
    });
    expect(
      evaluateDrag({ zone: 'bag', index: 0 }, target, context({ stationAccepts: () => false })).ok,
    ).toBe(false);
    expect(
      evaluateDrag({ zone: 'bag', index: 0 }, target, context({ stationHasRoom: () => false })).ok,
    ).toBe(false);
  });

  it('applies drops through the Action command bridge', () => {
    const calls: string[] = [];
    const commands: UiCommands = {
      selectSlot: () => undefined,
      moveItem: (from, to) => calls.push(`move:${from}:${to}`),
      dropSlot: (slot) => calls.push(`drop:${slot}`),
      depositSlotToStation: (stationId, slot) => calls.push(`deposit:${stationId}:${slot}`),
      printBackpack: () => undefined,
      printStation: () => undefined,
      collectStation: () => undefined,
      closePrinter: () => undefined,
    };
    applyInventoryDrop({ zone: 'bag', index: 0 }, { zone: 'bag', index: 2 }, commands);
    applyInventoryDrop({ zone: 'bag', index: 1 }, null, commands);
    applyInventoryDrop({ zone: 'bag', index: 3 }, { zone: 'station', stationId: 's1', index: 0 }, commands);
    expect(calls).toEqual(['move:0:2', 'drop:1', 'deposit:s1:3']);
  });
});
