// IndexedDB persistence (ARCHITECTURE.md: Saving).
// WHY idb-keyval: tiny promise wrapper, no schema upgrades to manage for a
// single save slot. Autosave ticks every 60 s and on visibilitychange to
// hidden (plus pagehide for the unload path); every write is fire-and-forget
// with a console warning so a full/blocked store can never break the loop.

import { del, get, set } from 'idb-keyval';
import type { SaveData } from './serialize.js';

/** The single save slot (ARCHITECTURE.md: no multi-slot in v1). */
export const SAVE_KEY = 'corelight-save-v1';

/** Autosave cadence in ms (ARCHITECTURE.md: every 60 s). */
export const AUTOSAVE_INTERVAL_MS = 60_000;

export async function hasSave(): Promise<boolean> {
  try {
    return (await get<SaveData>(SAVE_KEY)) !== undefined;
  } catch (err) {
    console.warn('save check failed', err);
    return false;
  }
}

export async function loadSave(): Promise<SaveData | null> {
  try {
    return (await get<SaveData>(SAVE_KEY)) ?? null;
  } catch (err) {
    console.warn('save load failed', err);
    return null;
  }
}

export async function storeSave(data: SaveData): Promise<boolean> {
  // Refuse snapshots with non-finite positions: a NaN serializes as null
  // in JSON and would load back as a "corrupt" save. The sim's action
  // validation keeps NaN out; this is the backstop at the IDB boundary.
  try {
    for (const entity of data.entities) {
      const p = entity.position;
      const q = entity.rotation;
      if (
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        !Number.isFinite(p.z) ||
        !Number.isFinite(q.x) ||
        !Number.isFinite(q.y) ||
        !Number.isFinite(q.z) ||
        !Number.isFinite(q.w)
      ) {
        console.warn('save store refused: non-finite transform');
        return false;
      }
    }
    // Global progression is arithmetic too: a NaN would serialize as null
    // and make the save unloadable, so refuse it at the IDB boundary.
    if (!Number.isFinite(data.research.data) || data.research.data < 0) {
      console.warn('save store refused: non-finite research data');
      return false;
    }
    await set(SAVE_KEY, data);
    return true;
  } catch (err) {
    console.warn('save store failed', err);
    return false;
  }
}

export async function clearSave(): Promise<void> {
  try {
    await del(SAVE_KEY);
  } catch (err) {
    console.warn('save clear failed', err);
  }
}

/**
 * Persist `snapshot()` on an interval and when the page hides. Returns a
 * stop function the session calls on quit; safe to call twice.
 */
export function startAutosave(snapshot: () => SaveData): () => void {
  let stopped = false;
  const save = (): void => {
    if (stopped) return;
    void storeSave(snapshot());
  };
  const intervalId = window.setInterval(save, AUTOSAVE_INTERVAL_MS);
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') save();
  };
  const onPageHide = (): void => {
    save();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  return () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(intervalId);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
  };
}
