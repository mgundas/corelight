import { describe, expect, it } from 'vitest';
import { ITEMS, isKnownItem, itemDef, loadItems } from '../../src/data/loadData.js';

describe('item catalog', () => {
  it('loads every resource from PROJECT.md', () => {
    const ids = new Set(ITEMS.map((d) => d.id));
    for (const id of [
      'resin',
      'silicate',
      'ferrite_ore',
      'cuprite_ore',
      'lumen_crystal',
      'biomass',
      'hydrite',
      'voidstone',
      'heartglass',
      'iron',
      'copper',
      'polymer',
      'research_sample',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
    // v1: one item per slot, nothing stackable.
    for (const def of ITEMS) expect(def.stackable).toBe(false);
  });

  it('looks definitions up by id', () => {
    expect(itemDef('resin').name).toBe('Resin');
    expect(isKnownItem('nope')).toBe(false);
    expect(() => itemDef('nope')).toThrow();
  });

  it('rejects bad data with clear errors', () => {
    expect(() => loadItems(null)).toThrow();
    expect(() => loadItems([{ id: 'Bad Id' }])).toThrow();
    expect(() => loadItems([{ id: 'x', name: 'X', color: 'red', shape: 'cube', size: 'small', stackable: false }])).toThrow();
    expect(() => loadItems([{ id: 'x', name: 'X', color: '#ffffff', shape: 'blob', size: 'small', stackable: false }])).toThrow();
    expect(() =>
      loadItems([
        { id: 'x', name: 'X', color: '#ffffff', shape: 'cube', size: 'small', stackable: false },
        { id: 'x', name: 'Y', color: '#ffffff', shape: 'cube', size: 'small', stackable: false },
      ]),
    ).toThrow();
  });
});
