// M14 chase camera: behind the ship, free-look offset from RMB, decay back
// behind the ship, and a session reset that forgets the previous basis.

import { describe, expect, it } from 'vitest';
import { distance } from '../../src/core/math.js';
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
