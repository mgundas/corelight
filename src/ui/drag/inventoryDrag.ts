// Pointer-event inventory drag (no HTML5 drag-and-drop API).
//
// Flow: pointerdown only records the start point. A drag begins after 5 px of
// movement, so plain clicks still select slots. While dragging, move/up/
// cancel/keydown listeners live on `window` (a lost pointer can never leave
// the drag stuck), the ghost is a pointer-events:none fixed element, and the
// drop target is found with elementFromPoint().closest('[data-drop]') —
// pointer capture makes event.target unreliable on pointerup.

import { resetDragStore, useDragStore, type DragPayload, type DragSource } from '../stores/dragStore.js';
import { uiCommands } from '../stores/commandsStore.js';
import {
  applyInventoryDrop,
  evaluateDrag,
  parseDropTarget,
  targetKey,
  type DragTarget,
  type InventoryRuleContext,
} from './inventoryRules.js';

/** Pixels of movement before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 5;

export interface DragRules {
  context(): InventoryRuleContext;
  /** Re-check after the world kept ticking during the drag. */
  stillThere(source: DragSource, itemId: string): boolean;
}

interface PressState {
  pointerId: number;
  startX: number;
  startY: number;
  source: DragSource;
  payload: DragPayload;
  rules: DragRules;
  dragging: boolean;
}

let press: PressState | null = null;
/** Swallow exactly one click after a drag release (capture phase). */
let swallowClick = false;

function targetAt(x: number, y: number): DragTarget | null {
  const element = document.elementFromPoint(x, y);
  const dropEl = element instanceof Element ? element.closest('[data-drop]') : null;
  return parseDropTarget(dropEl?.getAttribute('data-drop') ?? null);
}

function disarmSwallow(): void {
  swallowClick = false;
  window.removeEventListener('click', swallowNextClick, true);
}

function swallowNextClick(e: MouseEvent): void {
  if (!swallowClick) return;
  e.stopPropagation();
  e.preventDefault();
  disarmSwallow();
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.code !== 'Escape' || !press?.dragging) return;
  // Capture phase: the same Esc must not also close the panel/pause menu.
  // stopImmediatePropagation (not just stopPropagation) is required because
  // the pause handler also listens on window.
  e.stopImmediatePropagation();
  e.preventDefault();
  cleanup();
}

function onMove(e: PointerEvent): void {
  if (!press || e.pointerId !== press.pointerId) return;
  const dx = e.clientX - press.startX;
  const dy = e.clientY - press.startY;
  if (!press.dragging) {
    if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
    press.dragging = true;
    useDragStore.setState({
      active: { source: press.source, payload: press.payload },
      x: e.clientX,
      y: e.clientY,
      hoverKey: null,
      hoverOk: false,
      label: '',
    });
  }
  const target = targetAt(e.clientX, e.clientY);
  const evaluation = evaluateDrag(press.source, target, press.rules.context());
  useDragStore.setState({
    x: e.clientX,
    y: e.clientY,
    hoverKey: evaluation.key,
    hoverOk: evaluation.ok,
    label: evaluation.label,
  });
}

function onUp(e: PointerEvent): void {
  if (!press || e.pointerId !== press.pointerId) return;
  const current = press;
  const target = targetAt(e.clientX, e.clientY);
  cleanup();
  if (!current.dragging) return;
  // Releasing over a slot would also fire its click: swallow that one click
  // (capture phase) so a drag never selects/prints by accident.
  if (target) {
    swallowClick = true;
    window.addEventListener('click', swallowNextClick, true);
    // If no click follows (pointer capture edge case), never leave the
    // listener armed for an unrelated later click.
    window.setTimeout(disarmSwallow, 0);
  }
  if (!current.rules.stillThere(current.source, current.payload.itemId)) return;
  const evaluation = evaluateDrag(current.source, target, current.rules.context());
  const commands = uiCommands();
  if (!evaluation.ok || !commands) return;
  applyInventoryDrop(current.source, target, commands);
}

function onCancel(e: PointerEvent): void {
  if (!press || e.pointerId !== press.pointerId) return;
  cleanup();
}

function cleanup(): void {
  press = null;
  resetDragStore();
  disarmSwallow();
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onCancel);
  window.removeEventListener('keydown', onKeyDown, true);
}

/** Call from a slot's onPointerDown. */
export function beginSlotPress(
  e: PointerEvent,
  source: DragSource,
  payload: DragPayload,
  rules: DragRules,
): void {
  if (e.button !== 0) return;
  // A previous press can only leak if pointerup was lost: reset defensively.
  cleanup();
  press = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    source,
    payload,
    rules,
    dragging: false,
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKeyDown, true);
}

/** Hover key used by slots to tint green/red. */
export function slotHoverKey(zone: 'bag' | 'station', index: number, stationId?: string): string {
  return targetKey(
    zone === 'bag' ? { zone: 'bag', index } : { zone: 'station', stationId: stationId ?? '', index },
  );
}
