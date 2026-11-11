// Save-on-quit contract (#6): storeSave reports success so the menu can be
// honest ("Saved!" vs "Save failed"). In Node there is no IndexedDB, so the
// write fails and the contract is `false` — before the fix it resolved to
// `undefined` (void), which the menu treated as success.

import { describe, expect, it } from 'vitest';
import { storeSave } from '../../src/save/storage.js';

describe('storeSave', () => {
  it('resolves to a boolean success flag', async () => {
    const result = await storeSave({
      version: 2,
      seed: 1,
      time: 0,
      idCounter: 0,
      entities: [],
      edits: {},
      depleted: [],
      nodeCharges: {},
    });
    expect(typeof result).toBe('boolean');
  });

  it('refuses snapshots with non-finite positions', async () => {
    const result = await storeSave({
      version: 2,
      seed: 1,
      time: 0,
      idCounter: 1,
      entities: [
        {
          id: 'player_1',
          kind: 'player',
          planetId: 'sela',
          position: { x: NaN, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          components: {},
        },
      ],
      edits: {},
      depleted: [],
      nodeCharges: {},
    });
    expect(result).toBe(false);
  });
});
