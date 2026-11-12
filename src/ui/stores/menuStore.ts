// Menu store (React port of the old DOM menus). main.ts owns the callbacks;
// the store only says which overlay is showing. No World access here.

import { create } from 'zustand';

export interface MainMenuOptions {
  hasSave: boolean;
  error?: string | null;
  onContinue(): void;
  onNewGame(): void;
}

export interface PauseMenuOptions {
  onResume(): void;
  onSaveNow(): Promise<boolean>;
  onQuitToMenu(): Promise<boolean>;
}

export type MenuView =
  | { kind: 'none' }
  | { kind: 'main'; options: MainMenuOptions }
  | { kind: 'pause'; options: PauseMenuOptions };

export interface MenuStoreState {
  view: MenuView;
}

export const useMenuStore = create<MenuStoreState>(() => ({ view: { kind: 'none' } }));

export function showMainMenuInStore(options: MainMenuOptions): () => void {
  useMenuStore.setState({ view: { kind: 'main', options } });
  return () => {
    useMenuStore.setState((s) => (s.view.kind === 'main' ? { view: { kind: 'none' } } : s));
  };
}

export function showPauseMenuInStore(options: PauseMenuOptions): () => void {
  useMenuStore.setState({ view: { kind: 'pause', options } });
  return () => {
    useMenuStore.setState((s) => (s.view.kind === 'pause' ? { view: { kind: 'none' } } : s));
  };
}
