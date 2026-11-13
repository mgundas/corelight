// M14 chase camera: behind the ship, free-look offset from RMB, decay back
// behind the ship, and a session reset that forgets the previous basis.

import { describe, expect, it } from 'vitest';
import { add, distance, dot, normalize, scale, sub } from '../../src/core/math.js';
import { shuttleHeadingFor } from '../../src/sim/shuttleSteering.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { ShuttleCamera } from '../../src/game/shuttleCamera.js';
import type { ShuttleComponent } from '../../src/sim/entities.js';
import type { TerrainColliders } from '../../src/sim/physics/terrainColliders.js';

function shuttle(overrides: Partial<ShuttleComponent> = {}): ShuttleComponent {
  return {
    fuel: 0,
    pilotId: null,
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    up: { x: 0, y: 1, z: 0 },
    launchChargeS: 0,
    lastLookYaw: 0,
    airborne: false,
    input: null,
    ...overrides,
  };
}

const colliders = {
  castTerrainRay: () => null,
} as unknown as TerrainColliders;

const anchor = { x: 0, y: SELA.radius, z: 0 };
const frame = 1 / 60;

describe('ShuttleCamera', () => {
  it('preserves a world heading when the planetary up frame changes, including a vertical view', () => {
    const camera = new ShuttleCamera();
    const forward = { x: 1, y: 0, z: 0 };
    for (const up of [{ x: 0, y: 1, z: 0 }, normalize({ x: 1, y: 1, z: 0 }), forward]) {
      const heading = shuttleHeadingFor(up, forward);
      let view = camera.update(anchor, shuttle({ up, ...heading }), [SELA], colliders, frame, SELA, false);
      for (let i = 0; i < 180; i++) view = camera.update(anchor, shuttle({ up, ...heading }), [SELA], colliders, frame, SELA, false);
      const behind = normalize(sub(add(anchor, scale(up, 3)), view.position));
      expect(dot(behind, forward)).toBeGreaterThan(0.999);
      expect(Math.abs(dot(view.up, forward))).toBeLessThan(0.001);
    }
  });
  it('follows flight pitch and never extends beyond a close terrain hit', () => {
    const camera = new ShuttleCamera();
    const level = camera.update(anchor, shuttle(), [SELA], colliders, frame, SELA, false);
    let pitched = level;
    for (let i = 0; i < 120; i++) pitched = camera.update(anchor, shuttle({ pitch: 0.8 }), [SELA], colliders, frame, SELA, false);
    expect(Math.abs(pitched.position.y - level.position.y)).toBeGreaterThan(4);
    const blocked = { castTerrainRay: () => 0.4 } as unknown as TerrainColliders;
    const close = camera.update(anchor, shuttle(), [SELA], blocked, frame, SELA, false);
    expect(distance(close.position, close.focus)).toBeLessThan(0.4);
  });
  it('starts behind the ship and above its origin', () => {
    const camera = new ShuttleCamera();
    const view = camera.update(anchor, shuttle(), [SELA], colliders, frame, SELA, false);
    // The camera is above and behind the focus by the height offset; it
    // looks at the ship, not the sky.
    expect(view.position.y).toBeGreaterThan(view.focus.y);
    expect(distance(view.position, view.focus)).toBeGreaterThan(5);
  });

  it('free-looks with RMB without changing the ship heading', () => {
    const camera = new ShuttleCamera();
    const base = camera.update(anchor, shuttle(), [SELA], colliders, frame, SELA, false);
    camera.addFreeLook(200, 0);
    const looked = camera.update(anchor, shuttle(), [SELA], colliders, frame, SELA, true);
    expect(distance(base.position, looked.position)).toBeGreaterThan(1);
    // The shuttle component is untouched by the camera.
    expect(shuttle().yaw).toBe(0);
    // Releasing eases the offset back behind the ship.
    let decayed = looked;
    for (let i = 0; i < 120; i += 1) {
      decayed = camera.update(anchor, shuttle(), [SELA], colliders, frame, SELA, false);
    }
    expect(distance(decayed.position, base.position)).toBeLessThan(0.1);
  });

  it('pitch free-look raises/lowers the camera and reset clears it', () => {
    const camera = new ShuttleCamera();
    const level = camera.update(anchor, shuttle(), [SELA], colliders, frame, SELA, false);
    camera.addFreeLook(0, 200);
    const looked = camera.update(anchor, shuttle(), [SELA], colliders, frame, SELA, true);
    expect(Math.abs(looked.position.y - level.position.y)).toBeGreaterThan(0.5);
    camera.reset();
    const reset = camera.update(anchor, shuttle(), [SELA], colliders, frame, SELA, false);
    expect(distance(reset.position, level.position)).toBeLessThan(1e-9);
  });
});
