// Per-frame day/night environment assembly (M05): derives everything the
// render layer needs (sun, sky, fog, shadow focus) from sim values. Pure
// assembly only; three.js objects live in render/. Keeps Game.ts small.

import { distance, dot, length, sub, type Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import type { EnvironmentUpdate } from '../render/Renderer.js';
import { upAt } from '../sim/physics/frames.js';
import { depthBelowSurface, sunDirection } from '../sim/systems/sun.js';
import type { World } from '../sim/world.js';

export function nearestPlanet(planets: PlanetConfig[], pos: Vec3d): PlanetConfig {
  if (planets.length === 0) throw new Error('nearestPlanet: no planets');
  let nearest = planets[0] as PlanetConfig;
  let best = Infinity;
  for (const planet of planets) {
    const d = distance(pos, planet.center);
    if (d < best) {
      best = d;
      nearest = planet;
    }
  }
  return nearest;
}

/**
 * The player the camera follows, with its planet resolved (falling back to
 * the nearest planet for entities in space). Null when there is no player.
 */
export function findFollowed(
  world: World,
  planets: PlanetConfig[],
  playerId: string | null,
): { position: Vec3d; planet: PlanetConfig } | null {
  const entity = playerId ? world.entities.get(playerId) : undefined;
  if (!entity) return null;
  const planet =
    planets.find((p) => p.id === entity.planetId) ?? nearestPlanet(planets, entity.position);
  return { position: entity.position, planet };
}

/**
 * Environment state for a frame. `activePos` is the camera world position
 * (drives sky/fog); `focusWorld` is the shadow-frustum center (the player
 * in third-person, the camera in fly mode) and drives the hemisphere fill,
 * so the light on the player never darkens from rock the camera backs into.
 */
export function computeEnvironment(
  world: World,
  planets: PlanetConfig[],
  activePos: Vec3d,
  focusWorld: Vec3d,
  headlampOn: boolean,
): EnvironmentUpdate {
  const sunDir = sunDirection(world);
  const skyPlanet = nearestPlanet(planets, activePos);
  const skyLocal = sub(activePos, skyPlanet.center);
  const elevation = dot(sunDir, upAt(skyPlanet, activePos));
  const focusPlanet = nearestPlanet(planets, focusWorld);
  const focusLocal = sub(focusWorld, focusPlanet.center);
  return {
    sunDirWorld: sunDir,
    focusWorld,
    // Camera frame: sky background, fog, star fade.
    elevation,
    depthBelowM: depthBelowSurface(world, skyPlanet, skyLocal),
    altitudeM: length(skyLocal) - skyPlanet.radius,
    // Player frame: hemisphere fill + sun warmth on the lit subject.
    focusElevation: dot(sunDir, upAt(focusPlanet, focusWorld)),
    focusDepthBelowM: depthBelowSurface(world, focusPlanet, focusLocal),
    headlampOn,
    skyTint: skyPlanet.atmosphere.sky,
    groundTint: skyPlanet.atmosphere.ground,
    dayColor: skyPlanet.atmosphere.sky,
  };
}
