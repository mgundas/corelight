import { describe, expect, it } from 'vitest';
import { length, normalize, sub } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { nearestPlanet } from '../../src/planets/solarSystem.js';
import {
  gravityAt,
  primaryPlanet,
  selectPrimaryPlanet,
  sphereOfInfluence,
} from '../../src/sim/physics/gravity.js';
import { toLocalFrame, toWorldFrame, upAt } from '../../src/sim/physics/frames.js';

const SURFACE_TOP = { x: 0, y: SELA.radius, z: 0 };

describe('gravityAt', () => {
  it('points at the planet center with full magnitude at the surface', () => {
    const g = gravityAt([SELA], SURFACE_TOP);
    expect(g.planet?.id).toBe('sela');
    expect(length(g.vector)).toBeCloseTo(SELA.gravity, 6);
    // Direction is straight down (-Y at the top of the planet).
    const dir = normalize(g.vector);
    expect(dir.x).toBeCloseTo(0, 6);
    expect(dir.y).toBeCloseTo(-1, 6);
    expect(dir.z).toBeCloseTo(0, 6);
  });

  it('reduces magnitude deep inside (floaty core chamber)', () => {
    const core = gravityAt([SELA], { x: 0, y: 10, z: 0 });
    expect(core.planet?.id).toBe('sela');
    expect(length(core.vector)).toBeCloseTo(SELA.gravity * 0.15, 6);
    // Still points at the center.
    expect(normalize(core.vector).y).toBeCloseTo(-1, 6);
  });

  it('is zero outside the sphere of influence', () => {
    const far = { x: 0, y: sphereOfInfluence(SELA) + 100, z: 0 };
    const g = gravityAt([SELA], far);
    expect(g.planet).toBeNull();
    expect(g.vector).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('picks the dominant planet when SOIs overlap', () => {
    const clone = { ...SELA, id: 'clone', center: { x: 500, y: 0, z: 0 } };
    // Deep in Sela's falloff (r=100 -> 0.5x) but at the clone's surface (1x).
    const g = gravityAt([SELA, clone], { x: 100, y: 0, z: 0 });
    expect(g.planet?.id).toBe('clone');
  });
});

describe('primary planet', () => {
  it('uses the dominant SOI, not the geometrically nearest center', () => {
    // Both SOIs overlap; b is closer to the probe but Sela pulls harder.
    const b = { ...SELA, id: 'b', center: { x: 300, y: 0, z: 0 }, gravity: 5 };
    const probe = { x: 200, y: 0, z: 0 };
    expect(nearestPlanet([SELA, b], probe).id).toBe('b');
    expect(primaryPlanet([SELA, b], probe).id).toBe('sela');
    // Outside every SOI it falls back to the nearest planet.
    const deep = { x: 0, y: sphereOfInfluence(SELA) + 500, z: 0 };
    expect(primaryPlanet([SELA, b], deep).id).toBe('sela');
  });

  it('keeps the current owner until a challenger wins by the margin', () => {
    // a (gravity 4) owns the frame; b (gravity 6) becomes dominant first.
    const a = { ...SELA, id: 'a', gravity: 4 };
    const b = { ...SELA, id: 'b', center: { x: 1000, y: 0, z: 0 }, gravity: 6 };
    const nearB = { x: 520, y: 0, z: 0 };
    expect(primaryPlanet([a, b], nearB).id).toBe('b');
    expect(selectPrimaryPlanet([a, b], nearB, 'a', 200).id).toBe('a');
    // Clearly past the midpoint: the margin no longer holds.
    expect(selectPrimaryPlanet([a, b], { x: 800, y: 0, z: 0 }, 'a', 200).id).toBe('b');
    // No current owner: plain primary wins.
    expect(selectPrimaryPlanet([a, b], nearB, null, 200).id).toBe('b');
  });
});

describe('planet frames', () => {
  it('round-trips world <-> local', () => {
    const moved = { ...SELA, center: { x: 12000, y: 1500, z: 4000 } };
    const local = toLocalFrame(moved, { x: 12001, y: 1500, z: 4000 });
    expect(local).toEqual({ x: 1, y: 0, z: 0 });
    expect(toWorldFrame(moved, local)).toEqual({ x: 12001, y: 1500, z: 4000 });
  });

  it('upAt points away from the center', () => {
    expect(upAt(SELA, SURFACE_TOP)).toEqual({ x: 0, y: 1, z: 0 });
    // Side of the planet: up is +X.
    const side = upAt(SELA, { x: SELA.radius, y: 0, z: 0 });
    expect(side.x).toBeCloseTo(1, 6);
    // Defined (arbitrary axis) at the exact center.
    expect(length(upAt(SELA, { x: 0, y: 0, z: 0 }))).toBeCloseTo(1, 6);
  });

  it('gravity direction matches -up for a surface point', () => {
    const p = { x: SELA.radius, y: 0, z: 0 };
    const g = normalize(gravityAt([SELA], p).vector);
    const up = upAt(SELA, p);
    expect(sub(g, { x: -up.x, y: -up.y, z: -up.z }).x).toBeCloseTo(0, 6);
  });
});
