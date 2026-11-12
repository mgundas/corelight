// UI -> Action command bridge. Game installs the handlers once; React
// components and the drag rules call them. Every handler dispatches an
// Action (hard rule 2): UI code never mutates the World.

import { create } from 'zustand';

export interface UiCommands {
  selectSlot(slot: number): void;
  moveItem(from: number, to: number): void;
  dropSlot(slot: number): void;
  depositSlotToStation(stationId: string, slot: number): void;
  printBackpack(recipeId: string): void;
  printStation(stationId: string, recipeId: string): void;
  collectStation(stationId: string): void;
  closePrinter(): void;
  unlockResearch(id: string): void;
  depositResearchSample(stationId: string): void;
  collectResearch(stationId: string): void;
  closeResearch(): void;
}

interface CommandsStoreState {
  commands: UiCommands | null;
}

export const useCommandsStore = create<CommandsStoreState>(() => ({ commands: null }));

export function setUiCommands(commands: UiCommands): void {
  useCommandsStore.setState({ commands });
}

export function resetUiCommands(): void {
  useCommandsStore.setState({ commands: null });
}

export function uiCommands(): UiCommands | null {
  return useCommandsStore.getState().commands;
}
