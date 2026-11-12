import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import { normalize } from '../../src/core/math.js';
import { Atmosphere } from '../../src/render/atmosphere.js';
import { maybeShiftOrigin, resetOrigin, toLocal } from '../../src/render/floatingOrigin.js';

beforeEach(resetOrigin);
afterEach(resetOrigin);

describe('atmosphere surface/orbit separation', () => {
  it('never overlays nearby ground, hills or the astronaut on either planet, before or after an origin shift', () => {
    const scene = new THREE.Scene();
    const atmosphere = new Atmosphere(scene);
    const planets = [SELA, VORN];
    planets.forEach((planet) => atmosphere.addPlanet(planet));
    const directions = [{ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, normalize({ x: 1, y: -2, z: 3 })];
    for (const shift of [false, true]) {
      if (shift) maybeShiftOrigin(VORN.center);
      for (const [index, planet] of planets.entries()) {
        for (const direction of directions) {
          // Includes low valleys and an orbit camera above the tallest hills.
          for (const altitude of [-planet.surfaceAmplitude, 0, planet.surfaceAmplitude + 8]) {
            const r = planet.radius + altitude;
            const camera = toLocal({ x: planet.center.x + direction.x * r,
              y: planet.center.y + direction.y * r, z: planet.center.z + direction.z * r });
            atmosphere.update({ x: 0, y: 1, z: 0 }, camera);
            const near = scene.children[index] as THREE.Mesh;
            const far = scene.children[1 - index] as THREE.Mesh;
            expect(near.visible).toBe(false);
            expect((near.material as THREE.ShaderMaterial).uniforms['visibility']?.value).toBe(0);
            expect(far.visible).toBe(true);
          }
        }
      }
    }
    atmosphere.dispose();
  });

  it('smoothly hands off to the orbital volume outside the air layer and restores the surface on descent', () => {
    const scene = new THREE.Scene();
    const atmosphere = new Atmosphere(scene);
    atmosphere.addPlanet(SELA);
    const mesh = scene.children[0] as THREE.Mesh;
    function opacityAt(altitude: number): number {
      atmosphere.update({ x: 0, y: 1, z: 0 }, { x: 0, y: SELA.radius + altitude, z: 0 });
      return (mesh.material as THREE.ShaderMaterial).uniforms['visibility']?.value as number;
    }
    expect(opacityAt(60)).toBe(0);
    expect(mesh.visible).toBe(false);
    expect(opacityAt(90)).toBeCloseTo(0.5);
    expect(opacityAt(120)).toBe(1);
    expect(mesh.visible).toBe(true);
    let previous = opacityAt(60);
    for (let altitude = 61; altitude <= 120; altitude += 1) {
      const opacity = opacityAt(altitude);
      expect(opacity).toBeGreaterThanOrEqual(previous);
      expect(opacity - previous).toBeLessThan(0.03);
      previous = opacity;
    }
    expect(opacityAt(5)).toBe(0);
    expect(mesh.visible).toBe(false);
    atmosphere.dispose();
  });
});
