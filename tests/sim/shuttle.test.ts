// M14 shuttle pure helpers: speed caps, orientation, landed rule and fuel
// clamping. No World or Rapier is needed here.

import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import type { ShuttleComponent } from '../../src/sim/entities.js';
import {
  altitudeAbove,
  clampSpeed,
  easeUp,
  isLanded,
  pilotedShuttle,
  shuttleFuel,
  shuttleMaxSpeed,
  shuttleOrientation,
  shuttleSpeed,
} from '../../src/sim/shuttle.js';
import { rotateVector } from '../../src/core/math.js';
import { World } from '../../src/sim/world.js';

function shuttle(overrides: Partial<ShuttleComponent> = {}): ShuttleComponent {
  return {
    fuel: 0,
    pilotId: null,
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    up: { x: 0, y: 1, z: 0 },
    launchChargeS: 0,
    airborne: false,
    input: null,
    ...overrides,
  };
}

describe('shuttle speed caps', () => {
  it('rotates out of an antipodal arrival rather than leaving up locked in the old hemisphere', () => {
    let up = { x: 0, y: 1, z: 0 };
    for (let i = 0; i < 120; i++) up = easeUp(up, { x: 0, y: -1, z: 0 }, 3, 1 / 30);
    expect(up.y).toBeLessThan(-0.999);
  });
  it('caps at 120 m/s near the surface and grows to 600 with altitude', () => {
    const surface = { x: 0, y: SELA.radius, z: 0 };
    expect(shuttleMaxSpeed(SELA, surface, false)).toBe(120);
    const high = { x: 0, y: SELA.radius + 1000, z: 0 };
    expect(shuttleMaxSpeed(SELA, high, false)).toBe(600);
    const mid = { x: 0, y: SELA.radius + 200, z: 0 };
    const midCap = shuttleMaxSpeed(SELA, mid, false);
    expect(midCap).toBeGreaterThan(120);
    expect(midCap).toBeLessThan(600);
  });

  it('cruises at 300 in space and 600 with Shift', () => {
    const origin = { x: 0, y: 0, z: 0 };
    expect(shuttleMaxSpeed(null, origin, false)).toBe(300);
    expect(shuttleMaxSpeed(null, origin, true)).toBe(600);
  });

  it('clamps velocity without changing its direction', () => {
    const v = clampSpeed({ x: 300, y: 400, z: 0 }, 120);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(120, 6);
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBeGreaterThan(0);
  });
});

describe('shuttle state helpers', () => {
  it('counts a ship as landed only when parked and slow', () => {
    expect(isLanded(shuttle())).toBe(true);
    expect(isLanded(shuttle({ velocity: { x: 2, y: 0, z: 0 } }))).toBe(false);
    expect(isLanded(shuttle({ airborne: true }))).toBe(false);
  });

  it('clamps fuel and reports speed', () => {
    expect(shuttleFuel(shuttle({ fuel: 5 }))).toBe(2);
    expect(shuttleFuel(shuttle({ fuel: -3 }))).toBe(0);
    expect(shuttleSpeed(shuttle({ velocity: { x: 3, y: 4, z: 0 } }))).toBe(5);
  });

  it('measures altitude above the nominal surface', () => {
    expect(altitudeAbove(SELA, { x: 0, y: SELA.radius + 20, z: 0 })).toBeCloseTo(20, 6);
    expect(altitudeAbove(SELA, { x: 0, y: 10, z: 0 })).toBe(0);
  });

  it('eases the up vector toward radial up instead of snapping', () => {
    const target = { x: 1, y: 0, z: 0 };
    const once = easeUp({ x: 0, y: 1, z: 0 }, target, 3, 1 / 30);
    expect(once.y).toBeGreaterThan(0.9);
    expect(once.x).toBeGreaterThan(0);
    let up = { x: 0, y: 1, z: 0 };
    for (let i = 0; i < 120; i += 1) up = easeUp(up, target, 3, 1 / 30);
    expect(up.x).toBeCloseTo(1, 4);
    expect(up.y).toBeCloseTo(0, 4);
  });

  it('orients local +Y along up and tilts the nose with pitch', () => {
    const level = shuttleOrientation({ x: 0, y: 1, z: 0 }, 0, 0);
    const up = rotateVector({ x: 0, y: 1, z: 0 }, level);
    expect(up.y).toBeCloseTo(1, 6);
    const tilted = shuttleOrientation({ x: 0, y: 1, z: 0 }, 0, 0.5);
    const nose = rotateVector({ x: 0, y: 0, z: 1 }, tilted);
    expect(nose.y).toBeGreaterThan(0.1);
    // Yaw turns the nose sideways (positive yaw turns toward local east).
    const yawed = shuttleOrientation({ x: 0, y: 1, z: 0 }, Math.PI / 2, 0);
    const yawNose = rotateVector({ x: 0, y: 0, z: 1 }, yawed);
    expect(Math.abs(yawNose.z)).toBeGreaterThan(0.9);
  });

  it('resolves the piloted shuttle only while both links agree', () => {
    const world = new World(1, { planets: [SELA] });
    world.dispatch({
      type: 'spawnPlayer',
      planetId: SELA.id,
      position: { x: 0, y: SELA.radius, z: 0 },
    });
    world.tick();
    const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
    const playerComp = world.entities.get(playerId)?.components.player;
    if (!playerComp) throw new Error('no player');
    playerComp.pilotingShuttleId = 'shuttle_1';
    expect(pilotedShuttle(world, playerId)).toBeUndefined();
    world.entities.set('shuttle_1', {
      id: 'shuttle_1',
      kind: 'shuttle',
      planetId: SELA.id,
      position: { x: 0, y: SELA.radius, z: 0 },
      rotation: { ...IDENTITY_QUAT },
      components: { shuttle: shuttle({ pilotId: playerId }) },
    });
    expect(pilotedShuttle(world, playerId)?.id).toBe('shuttle_1');
    world.entities.get('shuttle_1')!.components.shuttle!.pilotId = null;
    expect(pilotedShuttle(world, playerId)).toBeUndefined();
  });
});
