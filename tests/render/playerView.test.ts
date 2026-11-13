// PlayerView interpolation: the avatar and the orbit camera must share one
// render transform, or they disagree every frame and the walk visibly
// judders. These pin the shared lerp (including the teleport snap).

import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { resetOrigin } from '../../src/render/floatingOrigin.js';
import { PlayerView } from '../../src/render/views/playerView.js';

describe('PlayerView.interpolatedWorld', () => {
  it('snaps samples when boarding or exiting rather than blending through terrain', () => {
    const view = new PlayerView();
    view.pushSample({ x: 0, y: 401, z: 0 }, IDENTITY_QUAT);
    view.pushSample({ x: 3, y: 400, z: 0 }, IDENTITY_QUAT);
    view.setSuitVisible(false);
    expect(view.interpolatedWorld(0)).toEqual({ x: 3, y: 400, z: 0 });
    view.pushSample({ x: 6, y: 401.2, z: 0 }, IDENTITY_QUAT);
    view.setSuitVisible(true);
    expect(view.interpolatedWorld(0)).toEqual({ x: 6, y: 401.2, z: 0 });
    view.dispose();
  });
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

  it('interpolates the suit orientation between ticks without changing the target sample', () => {
    resetOrigin();
    const view = new PlayerView();
    view.pushSample({ x: 0, y: 0, z: 0 }, { ...IDENTITY_QUAT });
    view.pushSample({ x: 0, y: 0, z: 0 }, { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 });
    view.render(0.5);
    expect(view.group.quaternion.y).toBeCloseTo(Math.sin(Math.PI / 8));
    view.render(1);
    expect(view.group.quaternion.y).toBeCloseTo(Math.SQRT1_2);
    view.dispose();
  });
});
