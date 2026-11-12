// Shared backpack slot component: drag source, drop target and click-to-
// select. Pointer events only (no HTML5 drag API).

import { useCommandsStore } from '../stores/commandsStore.js';
import { useDragStore, type DragPayload } from '../stores/dragStore.js';
import { useHudStore, type HudSlotView } from '../stores/hudStore.js';
import { usePrinterStore } from '../stores/printerStore.js';
import { beginSlotPress, slotHoverKey, type DragRules } from '../drag/inventoryDrag.js';

/** Drag rules backed by the presentation stores (never the World). */
export function bagDragRules(): DragRules {
  return {
    context: () => ({
      bagItemId: (index) => useHudStore.getState().slots[index]?.itemId ?? null,
      stationAccepts: (stationId, itemId) => {
        const station = usePrinterStore.getState().view?.station;
        return station?.stationId === stationId && station.acceptsItemIds.includes(itemId);
      },
      stationHasRoom: (stationId) => {
        const station = usePrinterStore.getState().view?.station;
        return station?.stationId === stationId && station.slots.includes(null);
      },
    }),
    stillThere: (source, itemId) => useHudStore.getState().slots[source.index]?.itemId === itemId,
  };
}

export interface InventorySlotProps {
  index: number;
  slot: HudSlotView | null;
  selected: boolean;
  /** Compact HUD slot vs the wider panel slot. */
  variant?: 'hud' | 'panel';
  /** Show the 1-8 shortcut number. */
  showNumber?: boolean;
}

export function InventorySlot({ index, slot, selected, variant = 'hud', showNumber = true }: InventorySlotProps) {
  const hoverKey = slotHoverKey('bag', index);
  const hovered = useDragStore((s) => s.hoverKey === hoverKey);
  const hoverOk = useDragStore((s) => s.hoverOk);
  const commands = useCommandsStore((s) => s.commands);
  const classes = [variant === 'hud' ? 'hud-slot' : 'bag-slot'];
  if (selected) classes.push('selected');
  if (slot) classes.push('filled');
  if (hovered) classes.push(hoverOk ? 'drop-ok' : 'drop-bad');
  const payload: DragPayload | null = slot
    ? { itemId: slot.itemId, name: slot.name, color: slot.color }
    : null;
  return (
    <div
      className={classes.join(' ')}
      data-drop={`bag:${index}`}
      title={slot ? slot.name : 'Empty slot'}
      style={{ ['--slot-color' as string]: slot ? slot.color : 'transparent' }}
      onPointerDown={(e) => {
        if (!payload) return;
        beginSlotPress(e.nativeEvent, { zone: 'bag', index }, payload, bagDragRules());
      }}
      onClick={() => commands?.selectSlot(index)}
    >
      {showNumber ? <span className="slot-number">{index + 1}</span> : null}
      <span className="slot-name">{slot ? slot.name : ''}</span>
    </div>
  );
}
