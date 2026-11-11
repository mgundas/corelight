// Tether/habitat/marker view tests (M08): posts, cables, domes and
// beacons track the entity list headlessly (no GPU needed for the scene
// graph). Live links draw green cables, dark posts draw red.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SELA } from '../../src/planets/configs/sela.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import type { Entity } from '../../src/sim/entities.js';
import { HabitatViews, MarkerViews, TetherViews } from '../../src/render/views/tetherView.js';

const spawn = findSpawnPosition(SELA, 1337);

function tether(id: string, dx: number, live: boolean, links: string[]): Entity {
  return {
    id,
    kind: 'tether',
    planetId: SELA.id,
    position: { x: spawn.x + dx, y: spawn.y, z: spawn.z },
    rotation: { ...IDENTITY_QUAT },
    components: { tether: { live, links: [...links] } },
  };
}

function lineColorHex(views: TetherViews): number[] {
  const hexes: number[] = [];
  views.group.traverse((obj) => {
    if (obj instanceof THREE.Line) {
      hexes.push((obj.material as THREE.LineBasicMaterial).color.getHex());
    }
  });
  return hexes;
}

describe('TetherViews', () => {
  it('draws one cable per link pair, green when live', () => {
    const views = new TetherViews();
    const a = tether('tether_a', 0, true, ['tether_b']);
    const b = tether('tether_b', 10, true, ['tether_a']);
    views.sync([a, b]);
    // Two posts + one shared cable.
    expect(views.group.children.length).toBe(3);
    expect(lineColorHex(views)).toEqual([0x39ff88]);
    // Killing the link on both ends removes the cable.
    views.sync([
      { ...a, components: { tether: { live: false, links: [] } } },
      { ...b, components: { tether: { live: false, links: [] } } },
    ]);
    expect(lineColorHex(views)).toEqual([]);
    // Removing the post removes it.
    views.sync([b]);
    expect(views.group.children.length).toBe(1);
    views.dispose();
  });

  it('draws red cables for dark posts', () => {
    const views = new TetherViews();
    views.sync([tether('tether_a', 0, false, ['tether_b']), tether('tether_b', 10, false, ['tether_a'])]);
    expect(lineColorHex(views)).toEqual([0xff4444]);
    views.dispose();
  });
});

describe('HabitatViews and MarkerViews', () => {
  it('tracks habitats and markers', () => {
    const habitats = new HabitatViews();
    const markers = new MarkerViews();
    const hub: Entity = {
      id: 'machine_1',
      kind: 'machine',
      planetId: SELA.id,
      position: { ...spawn },
      rotation: { ...IDENTITY_QUAT },
      components: { machine: { machineType: 'habitat' } },
    };
    const pack: Entity = {
      id: 'marker_1',
      kind: 'marker',
      planetId: SELA.id,
      position: { ...spawn },
      rotation: { ...IDENTITY_QUAT },
      components: {},
    };
    habitats.sync([hub]);
    markers.sync([pack]);
    expect(habitats.group.children.length).toBe(1);
    expect(markers.group.children.length).toBe(1);
    habitats.sync([]);
    markers.sync([]);
    expect(habitats.group.children.length).toBe(0);
    expect(markers.group.children.length).toBe(0);
    habitats.dispose();
    markers.dispose();
  });
});
