// Flight HUD projection (M14). Pure read-only assembly from World state:
// speed, altitude over the dominant planet, a marker for every planet with
// its distance, and a marker for every habitat/base with a compass bearing.
// The React HUD renders this; nothing here mutates the sim.

import { SHUTTLE_FUEL_MAX, SHUTTLE_LAUNCH_HOLD_S } from '../core/constants.js';
import { cross, distance, dot, normalize, sub, type Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { nearestPlanet } from '../planets/solarSystem.js';
import type { EntityId } from '../sim/entities.js';
import { moveBasis } from '../sim/physics/frames.js';
import { altitudeAbove, isLanded, pilotedShuttle, shuttleFuel, shuttleSpeed } from '../sim/shuttle.js';
import type { World } from '../sim/world.js';

export interface FlightMarker {
  label: string;
  distanceM: number;
  /** Bearing right of the ship's nose, degrees in [-180, 180]; 0 when unreachable by bearing. */
  bearingDeg: number;
  /** Pitch correction above/below the actual nose, including in deep space. */
  elevationDeg: number;
  /** Whether this marker belongs to the current physics planet. */
  samePlanet: boolean;
}

export interface FlightStatus {
  speedMps: number;
  altitudeM: number;
  fuel: number;
  maxFuel: number;
  /** 0..1 Space-hold launch charge (only meaningful with a full pair). */
  launchCharge: number;
  landed: boolean;
  planets: FlightMarker[];
  habitats: FlightMarker[];
}

export function flightDirectionTo(
  origin: Vec3d,
  yaw: number,
  pitch: number,
  up: Vec3d,
  target: Vec3d,
): Pick<FlightMarker, 'bearingDeg' | 'elevationDeg'> {
  const to = normalize(sub(target, origin));
  const { forward, right } = moveBasis(up, yaw, pitch);
  const f = dot(to, forward);
  const r = dot(to, right);
  const u = dot(to, normalize(cross(right, forward)));
  return { bearingDeg: Math.atan2(r, f) * 180 / Math.PI,
    elevationDeg: Math.atan2(u, Math.hypot(f, r)) * 180 / Math.PI };
}

/** Flight readout for the piloted shuttle, or null when on foot. */
export function flightStatusFor(
  world: World,
  planets: PlanetConfig[],
  playerId: EntityId | null,
): FlightStatus | null {
  if (!playerId) return null;
  const entity = pilotedShuttle(world, playerId);
  const shuttle = entity?.components.shuttle;
  if (!entity || !shuttle) return null;
  const planet =
    planets.find((p) => p.id === entity.planetId) ?? nearestPlanet(planets, entity.position);
  const up = normalize(shuttle.up);
  const shippedPlanets: FlightMarker[] = planets.map((p) => ({
    label: p.name,
    distanceM: Math.max(
      0,
      distance(entity.position, p.center) - p.radius,
    ),
    ...flightDirectionTo(entity.position, shuttle.yaw, shuttle.pitch, up, p.center),
    samePlanet: p.id === entity.planetId,
  }));
  const habitats: FlightMarker[] = [];
  for (const other of world.entities.values()) {
    if (other.kind !== 'machine' || other.components.machine?.machineType !== 'habitat') continue;
    const otherPlanet = planets.find((p) => p.id === other.planetId) ?? null;
    habitats.push({
      label: otherPlanet ? `Base · ${otherPlanet.name}` : 'Base',
      distanceM: distance(entity.position, other.position),
      ...flightDirectionTo(
        entity.position,
        shuttle.yaw,
        shuttle.pitch,
        up,
        other.position,
      ),
      samePlanet: other.planetId === entity.planetId,
    });
  }
  habitats.sort((a, b) => a.distanceM - b.distanceM);
  return {
    speedMps: shuttleSpeed(shuttle),
    altitudeM: altitudeAbove(planet, entity.position),
    fuel: shuttleFuel(shuttle),
    maxFuel: SHUTTLE_FUEL_MAX,
    launchCharge: Math.min(1, Math.max(0, shuttle.launchChargeS / SHUTTLE_LAUNCH_HOLD_S)),
    landed: isLanded(shuttle),
    planets: shippedPlanets,
    habitats,
  };
}
