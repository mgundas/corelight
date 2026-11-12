// View-visibility regression test (M08 fix): entities in the sim must end
// up as hittable meshes in the scene. A headless camera ray aimed at the
// synced post/dome must HIT it — this pins the "sim says live, screen shows
// nothing" failure mode without a GPU (raycast covers geometry + transforms
// + scene membership, i.e. everything short of rasterization).

import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SELA } from '../../src/planets/configs/sela.js';
import { SIM_DT } from '../../src/core/constants.js';
import { upAt, moveBasis } from '../../src/sim/physics/frames.js';
import { setupWorldSystems } from '../../src/game/worldSetup.js';
import { initPhysics } from '../../src/sim/physics/rapierWorld.js';
import { buildColliderData } from '../../src/terrain/colliders.js';
import { TetherViews, HabitatViews } from '../../src/render/views/tetherView.js';
import { toLocal } from '../../src/render/floatingOrigin.js';
import type { ColliderPool, ColliderRequest, ColliderResult } from '../../src/terrain/colliderPool.js';
import type { EntityId } from '../../src/sim/entities.js';
import { World } from '../../src/sim/world.js';

beforeAll(async () => {
  await initPhysics();
}, 30000);

function stubPool(): ColliderPool {
  const request = (req: ColliderRequest): Promise<ColliderResult> => {
    const data = buildColliderData(req.planetConfig, req.worldSeed, req.coord);
    return Promise.resolve({
      id: 0,
      key: data.key,
      origin: { x: data.origin.x, y: data.origin.y, z: data.origin.z },
      positions: data.positions,
      indices: data.indices,
      empty: data.empty,
    });
  };
  return { request } as unknown as ColliderPool;
}

describe('synced views are ray-hittable', () => {
  it('a camera aimed at the post and dome hits both', () => {
    const world = new World(1337, { planets: [SELA] });
    const setup = setupWorldSystems(world, [SELA], stubPool(), 1337, undefined, { devTethers: true });
    const playerId = setup.playerId as EntityId;
    const player = world.entities.get(playerId);
    if (!player) throw new Error('no player');
    world.dispatch({ type: 'placeTether', playerId });
    world.tick(SIM_DT);
    const post = [...world.entities.values()].find((e) => e.kind === 'tether');
    const hub = [...world.entities.values()].find(
      (e) => e.kind === 'machine' && e.components.machine?.machineType === 'habitat',
    );
    if (!post || !hub) throw new Error('missing post/habitat');

    const tethers = new TetherViews();
    const habitats = new HabitatViews();
    const scene = new THREE.Scene();
    scene.add(tethers.group);
    scene.add(habitats.group);
    tethers.sync(world.entities.values());
    habitats.sync(world.entities.values());
    expect(tethers.group.children.length).toBe(1);
    expect(habitats.group.children.length).toBe(1);
    // Resolve the full transform chain (group -> post -> pole/tip) exactly
    // like the frame loop does before rasterization.
    scene.updateMatrixWorld(true);

    // Camera 4 m behind + 2 m above the player.
    const up = upAt(SELA, player.position);
    const { forward } = moveBasis(up, 0, 0);
    const camWorld = {
      x: player.position.x - forward.x * 4 + up.x * 2,
      y: player.position.y - forward.y * 4 + up.y * 2,
      z: player.position.z - forward.z * 4 + up.z * 2,
    };
    const camLocal = toLocal(camWorld);
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 200000);
    camera.position.set(camLocal.x, camLocal.y, camLocal.z);
    camera.up.set(up.x, up.y, up.z);
    const ray = new THREE.Raycaster();
    const lookAt = (target: { x: number; y: number; z: number }, lift: number): void => {
      const local = toLocal(target);
      camera.lookAt(local.x, local.y + lift, local.z);
      camera.updateMatrixWorld(true);
      ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    };
    lookAt(post.position, 0.5);
    expect(ray.intersectObjects(tethers.group.children, true).length).toBeGreaterThan(0);
    lookAt(hub.position, 1.5);
    expect(ray.intersectObjects(habitats.group.children, true).length).toBeGreaterThan(0);

    tethers.dispose();
    habitats.dispose();
  });
});
