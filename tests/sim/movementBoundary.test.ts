import { beforeAll, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { World } from '../../src/sim/world.js';
import { disposePhysics, initPhysics, physicsWorldFor } from '../../src/sim/physics/rapierWorld.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { makePhysicsSystem } from '../../src/sim/physics/system.js';
import { TerrainColliders, type ColliderSource } from '../../src/sim/physics/terrainColliders.js';
import { buildColliderData } from '../../src/terrain/colliders.js';
import { dot, sub } from '../../src/core/math.js';
import { moveBasis, upAt } from '../../src/sim/physics/frames.js';
import { CameraRig } from '../../src/player/cameraRig.js';

beforeAll(initPhysics, 30000);

it('walks through the reported Sela location without a reversing movement frame or camera jump', async () => {
  const source: ColliderSource = { request: (planet, seed, coord) =>
    Promise.resolve({ id: 0, ...buildColliderData(planet, seed, coord) }) };
  const colliders = new TerrainColliders(source, physicsWorldFor);
  const world = new World(1337);
  world.addSystem(makePhysicsSystem({ planets: [SELA], worldSeed: 1337, colliders }));
  const surface = findSpawnPosition(SELA, 1337, { x: 52.2, y: 391.1, z: 17.9 });
  const up = upAt(SELA, surface);
  // Settle from clear air: the radial spawn finder can overlap a capsule
  // with this sloping hill even while its center is outside the density.
  const spawn = { x: surface.x + up.x * 3, y: surface.y + up.y * 3, z: surface.z + up.z * 3 };
  world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: spawn });
  async function tick(): Promise<void> {
    world.tick();
    await Promise.resolve(); await Promise.resolve();
  }
  try {
    for (let i = 0; i < 120; i += 1) await tick();
    const player = [...world.entities.values()].find((entity) => entity.kind === 'player');
    expect(player).toBeDefined();
    if (!player) throw new Error('player missing');
    expect(player.components.player?.grounded).toBe(true);
    const start = { ...player.position };
    const forward = moveBasis(upAt(SELA, start), 0, 0).forward;
    const rig = new CameraRig();
    let lastCamera = { ...start };
    let largestCameraStep = 0;
    for (let i = 0; i < 120; i += 1) {
      world.dispatch({ type: 'playerInput', playerId: player.id, move: { x: 0, z: 1 },
        jump: false, sprint: false, lookYaw: 0, lookPitch: 0 });
      await tick();
      rig.update(player.position, upAt(SELA, player.position), () => null, 1 / 30);
      if (i > 0) largestCameraStep = Math.max(largestCameraStep, Math.hypot(
        rig.position.x - lastCamera.x, rig.position.y - lastCamera.y, rig.position.z - lastCamera.z));
      lastCamera = { ...rig.position };
    }
    expect(dot(sub(player.position, start), forward), `start ${JSON.stringify(start)}, end ${JSON.stringify(player.position)}, state ${JSON.stringify(player.components.player)}, colliders ${colliders.loadedCount}/${colliders.pendingCount}, ground ${colliders.groundState(player.position, [SELA])}`).toBeGreaterThan(12);
    expect(largestCameraStep).toBeLessThan(1);
  } finally {
    colliders.dispose(); disposePhysics();
  }
}, 60000);
