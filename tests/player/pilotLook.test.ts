import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, updateSettings } from '../../src/core/settings.js';
import { PilotLook } from '../../src/player/pilotLook.js';

beforeEach(() => updateSettings(DEFAULT_SETTINGS));

describe('continuous flight mouse input', () => {
  it('continues beyond the orbit pitch limit, and reversing immediately changes input', () => {
    const look = new PilotLook();
    look.setActive(true);
    look.steer(0, -3000);
    const first = look.steering().pitch;
    expect(first).toBeGreaterThan(Math.PI / 2);
    look.steer(0, -100);
    expect(look.steering().pitch).toBeGreaterThan(first);
    look.steer(0, 200);
    expect(look.steering().pitch).toBeLessThan(first);
  });
  it('keeps RMB look separate, preserves steering through UI resets, and clears it on exit', () => {
    const look = new PilotLook();
    look.setActive(true);
    look.steer(100, 50);
    const steering = look.steering();
    look.addLook(300, 150);
    expect(look.consume()).toEqual({ dx: 300, dy: 150 });
    look.resetDeltas();
    expect(look.steering()).toEqual(steering);
    look.setActive(false);
    expect(look.steering()).toEqual({ yaw: 0, pitch: 0 });
  });
});
