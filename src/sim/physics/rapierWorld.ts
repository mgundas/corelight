// Rapier physics worlds, one per active planet frame (ARCHITECTURE.md).
// Global gravity stays zero: spherical gravity is integrated by hand each
// tick (sim/physics/characterController.ts), so bodies never feel the
// wrong "down". Must call initPhysics() (async wasm boot) before the game
// starts; systems take worlds from physicsWorldFor().

import RAPIER from '@dimforge/rapier3d-compat';

let ready = false;
const worlds = new Map<string, RAPIER.World>();

export function isPhysicsReady(): boolean {
  return ready;
}

/** Async wasm init. Call once (main.ts) before any world is created. */
export async function initPhysics(): Promise<void> {
  if (ready) return;
  await RAPIER.init();
  ready = true;
}

/** Zero-gravity Rapier world for a planet's local frame, created on demand. */
export function physicsWorldFor(planetId: string): RAPIER.World {
  if (!ready) throw new Error('physics used before initPhysics()');
  let world = worlds.get(planetId);
  if (!world) {
    world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    worlds.set(planetId, world);
  }
  return world;
}

/** Test/owner teardown: frees all worlds (controllers free themselves). */
export function disposePhysics(): void {
  for (const world of worlds.values()) world.free();
  worlds.clear();
}
