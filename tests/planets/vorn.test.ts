// M13: Vorn config pins every PROJECT.md/ARCHITECTURE.md number, the derived
// cavern stack, spawns, layer hazards and Vorn-only resources.

import { describe, expect, it } from 'vitest';
import { OXYGEN_VORN_COLD_MULT } from '../../src/core/constants.js';
import { length, sub } from '../../src/core/math.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import { PLANETS } from '../../src/planets/solarSystem.js';
import { cavernStack, createDensityField, layerAt } from '../../src/terrain/density.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { pickResource } from '../../src/sim/nodes.js';

describe('Vorn config', () => {
  it('matches PROJECT.md and ARCHITECTURE.md', () => {
    expect(VORN.id).toBe('vorn');
    expect(VORN.name).toBe('Vorn');
    expect(VORN.center).toEqual({ x: 12000, y: 1500, z: 4000 });
    expect(VORN.radius).toBe(320);
    expect(VORN.layers.map((layer) => [layer.name, layer.fromDepth, layer.toDepth])).toEqual([
      ['surface', 0, 25],
      ['crust', 25, 110],
      ['mantle', 110, 282],
    ]);
    expect(VORN.layers.map((layer) => layer.hardness)).toEqual([1, 2, 4]);
    expect(VORN.core.chamberRadius).toBe(32);
    expect(VORN.core.shellThickness).toBe(6);
    expect(VORN.core.shellHardness).toBe(4);
    expect(VORN.lodMaxLevel).toBe(5);
    // Mantle ends where the core shell begins: radius - chamber - shell.
    expect(VORN.layers[2]?.toDepth).toBe(VORN.radius - VORN.core.chamberRadius - VORN.core.shellThickness);
  });

  it('registers both planets with their fixed centers', () => {
    expect(PLANETS.map((planet) => planet.id)).toEqual(['sela', 'vorn']);
    expect(PLANETS[0]?.center).toEqual({ x: 0, y: 0, z: 0 });
    expect(PLANETS[1]?.center).toEqual({ x: 12000, y: 1500, z: 4000 });
  });

  it('derives five cavern floors that never touch the core shell', () => {
    const stack = cavernStack(VORN);
    expect(stack.count).toBe(5);
    expect(stack.start).toBe(25);
    expect(stack.pitch).toBe(46);
    const shellOuterDepth = VORN.radius - VORN.core.chamberRadius - VORN.core.shellThickness;
    expect(stack.start + stack.count * stack.pitch).toBeLessThanOrEqual(shellOuterDepth);
  });

  it('maps depths to layers with the cold and heat hazards as data', () => {
    const at = (depth: number): ReturnType<typeof layerAt> =>
      layerAt(VORN, 0, VORN.radius - depth, 0);
    expect(at(10).name).toBe('surface');
    expect(at(10).hazardOxygenMult).toBe(OXYGEN_VORN_COLD_MULT);
    expect(at(10).hazardOxygenMult).toBe(1.5);
    expect(at(10).hazardKind).toBe('cold');
    expect(at(50).name).toBe('crust');
    expect(at(50).hazardOxygenMult).toBeUndefined();
    expect(at(200).name).toBe('mantle');
    expect(at(200).hardness).toBe(4);
    expect(at(200).hazardOxygenMult).toBe(2);
    expect(at(200).hazardKind).toBe('heat');
    // Inside the shell: hardness 4 (needs Drill Mk3), then hollow chamber.
    expect(at(VORN.radius - 33).name).toBe('core_shell');
    expect(at(VORN.radius - 33).hardness).toBe(4);
    expect(at(VORN.radius).name).toBe('core_chamber');
  });

  it('spawns the player on the surface and has a hollow core', () => {
    const spawn = findSpawnPosition(VORN, 1337);
    const r = length(sub(spawn, VORN.center));
    expect(r).toBeGreaterThan(VORN.radius);
    expect(r).toBeLessThan(VORN.radius + 20);
    const field = createDensityField(VORN, 1337);
    expect(field.density(0, 0, 0)).toBeLessThan(0);
    // Air at the spawn, solid just below it (marched along the pole).
    expect(field.density(0, r, 0)).toBeLessThan(0);
    expect(field.density(0, r - 3, 0)).toBeGreaterThanOrEqual(0);
  });

  it('places hydrite on the surface, voidstone in the mantle and no biomass', () => {
    // rng 0.99 selects the last surface option (the plant slot).
    expect(pickResource(() => 0.99, 'vorn', 'surface', false)).toBe('hydrite');
    expect(pickResource(() => 0.99, 'sela', 'surface', false)).toBe('biomass');
    // 0.1 is under the 25% voidstone roll on Vorn's mantle.
    expect(pickResource(() => 0.1, 'vorn', 'mantle', false)).toBe('voidstone');
    expect(pickResource(() => 0.1, 'sela', 'mantle', false)).not.toBe('voidstone');
    expect(pickResource(() => 0.5, 'vorn', 'core_shell', true)).toBe('voidstone');
    expect(pickResource(() => 0.5, 'sela', 'core_shell', true)).toBe('heartglass');
  });
});
