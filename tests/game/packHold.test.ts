// M10 hold-E timing: a tap releases (normal tap-E action), holding for 1 s
// packs, looking away resets, and a fresh press is required afterwards.

import { describe, expect, it } from 'vitest';
import { PackHold } from '../../src/game/packHold.js';

describe('PackHold', () => {
  it('reports hold then pack at the 1 s threshold', () => {
    const hold = new PackHold();
    hold.press('printer', 0);
    expect(hold.update(true, 500, 'printer')).toBe('hold');
    expect(hold.update(true, 999, 'printer')).toBe('hold');
    expect(hold.update(true, 1000, 'printer')).toBe('pack');
    // Already consumed: no double pack.
    expect(hold.update(true, 1200, 'printer')).toBe('idle');
  });

  it('reports release for a tap and resets on target change', () => {
    const hold = new PackHold();
    hold.press('printer', 0);
    expect(hold.update(false, 200, 'printer')).toBe('release');
    expect(hold.update(true, 300, 'printer')).toBe('idle');
    hold.press('printer', 400);
    expect(hold.update(true, 500, 'solar')).toBe('idle');
    expect(hold.update(true, 600, 'printer')).toBe('idle');
  });
});
