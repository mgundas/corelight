// M13 review: the item-light pool repositions from world doubles after a
// floating-origin shift (it is originManaged and must never drift).

import { afterEach, describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { maybeShiftOrigin, resetOrigin, toLocal } from '../../src/render/floatingOrigin.js';
import { ItemLights } from '../../src/render/itemLights.js';
import type { ItemEmitter } from '../../src/render/views/itemView.js';

const EMITTER: ItemEmitter = {
  position: { x: 100, y: 50, z: 0 },
  color: '#ffffff',
  intensity: 2,
};

afterEach(() => {
  resetOrigin();
});

describe('item light origin shifts', () => {
  it('keeps the point light on the emitter in local coordinates', () => {
    resetOrigin();
    const lights = new ItemLights();
    lights.update({ x: 0, y: 0, z: 0 }, [EMITTER]);
    const light = lights.group.children[0] as THREE.PointLight;
    expect(light.visible).toBe(true);
    expect(light.position.x).toBeCloseTo(100, 6);

    // Fly ~2 km: the origin jumps and the light must follow the doubles.
    expect(maybeShiftOrigin({ x: 2016, y: 0, z: 0 })).not.toBe(null);
    lights.update({ x: 2016, y: 0, z: 0 }, [EMITTER]);
    const local = toLocal(EMITTER.position);
    expect(light.position.x).toBeCloseTo(local.x, 3);
    expect(light.position.y).toBeCloseTo(local.y, 3);
    expect(light.position.z).toBeCloseTo(local.z, 3);
    lights.dispose();
  });
});
