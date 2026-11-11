// TerrainTool tests: edit rate limiting, radius clamping, flatten-plane
// capture at stroke start, and the no-hit / no-button null cases.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { TerrainTool, type ToolAim } from '../../src/player/terrainTool.js';

const AIM: ToolAim = {
  hit: { x: 1, y: 2, z: 3 },
  normal: { x: 0, y: 1, z: 0 },
  planet: SELA,
};

describe('TerrainTool', () => {
  it('rate-limits edits to 10 per second', () => {
    const tool = new TerrainTool();
    const buttons = { dig: true, add: false, flatten: false };
    const first = tool.update(0, 'player_x', buttons, AIM);
    expect(first).not.toBeNull();
    expect(first?.type).toBe('terrainEdit');
    if (first?.type !== 'terrainEdit') throw new Error('unreachable');
    expect(first.mode).toBe('dig');
    expect(first.center).toEqual(AIM.hit);
    // 50 ms later: too soon.
    expect(tool.update(50, 'player_x', buttons, AIM)).toBeNull();
    // 100 ms after the first: due again.
    expect(tool.update(100, 'player_x', buttons, AIM)).not.toBeNull();
  });

  it('clamps the brush radius to 1..4 m', () => {
    const tool = new TerrainTool();
    for (let i = 0; i < 20; i += 1) tool.adjustRadius(-1);
    expect(tool.radius).toBe(4);
    for (let i = 0; i < 20; i += 1) tool.adjustRadius(1);
    expect(tool.radius).toBe(1);
  });

  it('ignores horizontal wheel (deltaY 0)', () => {
    const tool = new TerrainTool();
    const before = tool.radius;
    tool.adjustRadius(0);
    expect(tool.radius).toBe(before);
  });

  it('captures the flatten plane at stroke start and freezes it', () => {
    const tool = new TerrainTool();
    const buttons = { dig: false, add: false, flatten: true };
    const first = tool.update(0, 'player_x', buttons, AIM);
    if (first?.type !== 'terrainEdit') throw new Error('expected a flatten action');
    expect(first.flattenPlane?.point).toEqual({ x: 1, y: 2, z: 3 });
    // Aim moves mid-stroke: the plane stays where the stroke started.
    // (Advance the clock so the rate limiter does not mask the check.)
    const moved: ToolAim = {
      hit: { x: 9, y: 9, z: 9 },
      normal: { x: 1, y: 0, z: 0 },
      planet: SELA,
    };
    const second = tool.update(100, 'player_x', buttons, moved);
    if (second?.type !== 'terrainEdit') throw new Error('expected a flatten action');
    expect(second.center).toEqual({ x: 9, y: 9, z: 9 });
    expect(second.flattenPlane?.point).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('captures the plane when aim appears mid-press and resets on release', () => {
    const tool = new TerrainTool();
    const buttons = { dig: false, add: false, flatten: true };
    const noHit: ToolAim = { hit: null, normal: null, planet: SELA };
    // Press F while looking at the sky: no plane, no action.
    expect(tool.update(0, 'player_x', buttons, noHit)).toBeNull();
    // Still holding, swing onto terrain: the stroke starts here.
    const first = tool.update(0, 'player_x', buttons, AIM);
    if (first?.type !== 'terrainEdit') throw new Error('expected a flatten action');
    expect(first.flattenPlane?.point).toEqual({ x: 1, y: 2, z: 3 });
    // Release clears the plane: the next stroke captures fresh.
    tool.update(100, 'player_x', { dig: false, add: false, flatten: false }, AIM);
    const moved: ToolAim = {
      hit: { x: 9, y: 9, z: 9 },
      normal: { x: 1, y: 0, z: 0 },
      planet: SELA,
    };
    const second = tool.update(200, 'player_x', buttons, moved);
    if (second?.type !== 'terrainEdit') throw new Error('expected a flatten action');
    expect(second.flattenPlane?.point).toEqual({ x: 9, y: 9, z: 9 });
  });

  it('returns null without a hit or without buttons', () => {
    const tool = new TerrainTool();
    const noHit: ToolAim = { hit: null, normal: null, planet: SELA };
    expect(tool.update(0, 'player_x', { dig: true, add: false, flatten: false }, noHit)).toBeNull();
    expect(tool.update(200, 'player_x', { dig: false, add: false, flatten: false }, AIM)).toBeNull();
  });
});
