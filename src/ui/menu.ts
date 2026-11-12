// Main + pause menu bridge (React port). main.ts owns the session callbacks;
// these helpers only toggle the menu store, which MenuViews renders.

import {
  showMainMenuInStore,
  showPauseMenuInStore,
  type MainMenuOptions,
  type PauseMenuOptions,
} from './stores/menuStore.js';

export type { MainMenuOptions, PauseMenuOptions };

/** Full-screen title menu. Returns a dispose function. */
export function showMainMenu(opts: MainMenuOptions): () => void {
  return showMainMenuInStore(opts);
}

/** Pause menu over a frozen session. Returns a dispose function. */
export function showPauseMenu(opts: PauseMenuOptions): () => void {
  return showPauseMenuInStore(opts);
}
