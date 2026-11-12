// Tool equip state (Q) and brush selection (X).

import { describe, expect, it } from 'vitest';
import { ToolMode } from '../../src/game/toolMode.js';

describe('ToolMode', () => {
  it('starts stowed with the dig brush selected', () => {
    const mode = new ToolMode();
    expect(mode.active).toBe(false);
    expect(mode.brush).toBe('dig');
  });

  it('Q toggles equip and keeps the brush across stows', () => {
    const mode = new ToolMode();
    mode.toggle();
    expect(mode.active).toBe(true);
    mode.toggleBrush();
    expect(mode.brush).toBe('add');
    mode.toggle();
    expect(mode.active).toBe(false);
    mode.toggle();
    expect(mode.active).toBe(true);
    expect(mode.brush).toBe('add');
  });

  it('X only flips between dig and add', () => {
    const mode = new ToolMode();
    mode.toggleBrush();
    expect(mode.brush).toBe('add');
    mode.toggleBrush();
    expect(mode.brush).toBe('dig');
    mode.cancel();
    expect(mode.active).toBe(false);
  });
});
