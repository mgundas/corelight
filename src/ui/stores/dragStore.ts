// Inventory drag store (zustand): presentation only. The game logic never
// reads it — the drag controller calls the pure rules, which dispatch
// Actions through the UI command bridge.
//
// Do NOT use the HTML5 drag-and-drop API: this store drives a pointer-event
// drag (see ui/drag/inventoryDrag.ts).

import { create } from 'zustand';

export interface DragSource {
  zone: 'bag';
  index: number;
}

export interface DragPayload {
  itemId: string;
  name: string;
  color: string;
}

export interface DragStoreState {
  /** Non-null while a pointer drag is in flight. */
  active: { source: DragSource; payload: DragPayload } | null;
  x: number;
  y: number;
  hoverKey: string | null;
  hoverOk: boolean;
  label: string;
}

export const useDragStore = create<DragStoreState>(() => ({
  active: null,
  x: 0,
  y: 0,
  hoverKey: null,
  hoverOk: false,
  label: '',
}));

export function resetDragStore(): void {
  useDragStore.setState({
    active: null,
    x: 0,
    y: 0,
    hoverKey: null,
    hoverOk: false,
    label: '',
  });
}
