import { create } from 'zustand';

export const useDevItemsStore = create<{ open: boolean }>(() => ({ open: false }));
export function isDevItemsOpen(): boolean { return useDevItemsStore.getState().open; }
export function setDevItemsOpen(open: boolean): void { useDevItemsStore.setState({ open }); }
