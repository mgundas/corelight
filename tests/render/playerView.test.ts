// PlayerView interpolation: the avatar and the orbit camera must share one
// render transform, or they disagree every frame and the walk visibly
// judders. These pin the shared lerp (including the teleport snap).

import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { resetOrigin } from '../../src/render/floatingOrigin.js';
import { PlayerView } from '../../src/render/views/playerView.js';

describe('PlayerView.interpolatedWorld', () => {
  it('returns null before any sample', () => {
    resetOrigin();
    const view = new PlayerView();
    expect(view.interpolatedWorld(0.5)).toBeNull();
    view.dispose();
  });

  it('lerps between the last two tick samples', () => {
    resetOrigin();
    const view = new PlayerView();
    view.pushSample({ x: 0, y: 0, z: 0 }, { ...IDENTITY_QUAT });
    view.pushSample({ x: 3, y: 0, z: 0 }, { ...IDENTITY_QUAT });
    expect(view.interpolatedWorld(0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(view.interpolatedWorld(0.5)).toEqual({ x: 1.5, y: 0, z: 0 });
    expect(view.interpolatedWorld(1)).toEqual({ x: 3, y: 0, z: 0 });
    view.dispose();
  });

  it('snaps instead of streaking across teleports', () => {
    resetOrigin();
    const view = new PlayerView();
    view.pushSample({ x: 0, y: 0, z: 0 }, { ...IDENTITY_QUAT });
    view.pushSample({ x: 100, y: 0, z: 0 }, { ...IDENTITY_QUAT });
    expect(view.interpolatedWorld(0.5)).toEqual({ x: 100, y: 0, z: 0 });
    view.dispose();
  });
});
