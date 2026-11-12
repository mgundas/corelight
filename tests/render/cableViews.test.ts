// M10 cable rendering: one sagging line per cable, geometry cached for
// static frames, rebuilt when an endpoint moves or disappears.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import type { Entity } from '../../src/sim/entities.js';
import { snapWorld } from '../../src/sim/snapUtils.js';
import { CableViews } from '../../src/render/views/cableViews.js';
import { maybeShiftOrigin, resetOrigin, toLocal } from '../../src/render/floatingOrigin.js';

function platform(id: string, x: number): Entity {
  return {
    id,
    kind: 'platform',
    planetId: 'sela',
    position: { x, y: 400, z: 0 },
    rotation: { ...IDENTITY_QUAT },
    components: { placeable: { placeableId: 'platform' } },
  };
}

function cable(id: string, a: string, b: string): Entity {
  return {
    id,
    kind: 'cable',
    planetId: 'sela',
    position: { x: 2, y: 400.4, z: 0 },
    rotation: { ...IDENTITY_QUAT },
    components: {
      cable: {
        a: { entityId: a, snapIndex: 0 },
        b: { entityId: b, snapIndex: 0 },
      },
    },
  };
}

describe('cable views', () => {
  it('draws one line per cable and caches static geometry', () => {
    const views = new CableViews();
    const a = platform('a', 0);
    const b = platform('b', 4);
    const c = cable('c', 'a', 'b');
    views.sync([a, b, c]);
    expect(views.group.children).toHaveLength(1);
    const line = views.group.children[0] as THREE.Line;
    const geometry = line.geometry;
    expect(geometry.attributes['position']?.count).toBe(9);
    // Static frame: the same BufferGeometry instance is kept.
    views.sync([a, b, c]);
    expect((views.group.children[0] as THREE.Line).geometry).toBe(geometry);
    // Moving an endpoint rebuilds it.
    b.position = { x: 6, y: 400, z: 0 };
    views.sync([a, b, c]);
    expect((views.group.children[0] as THREE.Line).geometry).not.toBe(geometry);
    // Removing the cable removes the line; removing an endpoint hides it too.
    views.sync([a, b]);
    expect(views.group.children).toHaveLength(0);
    const dangling = cable('d', 'a', 'missing');
    views.sync([a, b, dangling]);
    expect(views.group.children).toHaveLength(0);
    views.dispose();
  });

  it('repositions cable endpoints after a floating-origin shift', () => {
    resetOrigin();
    const views = new CableViews();
    const a = platform('a', 0);
    const b = platform('b', 4);
    const c = cable('c', 'a', 'b');
    views.sync([a, b, c]);
    const aWorld = snapWorld(a, 0);
    const bWorld = snapWorld(b, 0);
    if (!aWorld || !bWorld) throw new Error('missing snap');
    // Fly ~2 km from the base: the origin jumps, the cable follows.
    expect(maybeShiftOrigin({ x: 2016, y: 0, z: 0 })).not.toBe(null);
    views.sync([a, b, c]);
    const line = views.group.children[0] as THREE.Line;
    const positions = line.geometry.attributes['position'] as THREE.BufferAttribute;
    const aLocal = toLocal(aWorld);
    const bLocal = toLocal(bWorld);
    expect(positions.getX(0)).toBeCloseTo(aLocal.x, 3);
    expect(positions.getY(0)).toBeCloseTo(aLocal.y, 3);
    expect(positions.getZ(0)).toBeCloseTo(aLocal.z, 3);
    expect(positions.getX(8)).toBeCloseTo(bLocal.x, 3);
    expect(positions.getY(8)).toBeCloseTo(bLocal.y, 3);
    expect(positions.getZ(8)).toBeCloseTo(bLocal.z, 3);
    views.dispose();
    resetOrigin();
  });
});
