// F1 debug overlay store: visible flag plus the formatted stats text.

import { create } from 'zustand';

export interface OverlayStoreState {
  visible: boolean;
  text: string;
}

export const useOverlayStore = create<OverlayStoreState>(() => ({
  visible: false,
  text: '',
}));

export function resetOverlayStore(): void {
  useOverlayStore.setState({ visible: false, text: '' });
}
