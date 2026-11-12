// Terrain-edit action handler (split from actions.ts to keep the dispatch
// switch short and the file under the 400-line hard rule). Validation,
// hardness filtering, soil accounting and node mining all stay sim-side.

import {
  SOIL_MAX,
  TOOL_MAX_RADIUS,
  TOOL_MIN_RADIUS,
  TOOL_RANGE_M,
  TOOL_RANGE_SLACK_M,
} from '../core/constants.js';
import { events } from '../core/events.js';
import { distance } from '../core/math.js';
import { layerAt } from '../terrain/density.js';
import type { FlattenPlane } from '../terrain/edits.js';
import type { Action } from './actions.js';
import { digSpeedMult, toolHardnessFor } from './drill.js';
import { mineNodes } from './mining.js';
import { baseFieldFor } from './tetherActions.js';
import type { World } from './world.js';

export function applyTerrainEdit(world: World, action: Extract<Action, { type: 'terrainEdit' }>): void {
  const entity = world.entities.get(action.playerId);
  const player = entity?.components.player;
  if (!entity || entity.kind !== 'player' || !player) return;
  const planet = world.planets.find((p) => p.id === action.planetId);
  if (!planet) return;
  // Terminal validation always emits: an action reaching a known player
  // and planet was processed, even when rejected (debug/UI counting
  // depends on it). Unknown players/planets stay silent (unprocessable).
  // The sim trusts no crafted action: the stroke must belong to the
  // player's planet and start within tool range of the player. NaN
  // centers/radii would corrupt soil accounting and saves, so they are
  // rejected; out-of-range radii clamp to the tool's brush limits.
  if (
    !Number.isFinite(action.radius) ||
    action.radius <= 0 ||
    !Number.isFinite(action.strength) ||
    typeof action.center?.x !== 'number' ||
    typeof action.center?.y !== 'number' ||
    typeof action.center?.z !== 'number' ||
    !Number.isFinite(action.center.x) ||
    !Number.isFinite(action.center.y) ||
    !Number.isFinite(action.center.z)
  ) {
    events.emit('actionApplied', { type: action.type });
    return;
  }
  const radius = Math.min(TOOL_MAX_RADIUS, Math.max(TOOL_MIN_RADIUS, action.radius));
  if (
    entity.planetId !== planet.id ||
    action.strength <= 0 ||
    !Number.isFinite(action.strength) ||
    distance(entity.position, action.center) > TOOL_RANGE_M + TOOL_RANGE_SLACK_M + radius
  ) {
    events.emit('actionApplied', { type: action.type });
    return;
  }
  // A non-finite flatten plane would smear NaN deltas into the edit
  // store (and then into saves): reject the stroke instead.
  if (action.flattenPlane) {
    const fp = action.flattenPlane;
    if (
      typeof fp.point?.x !== 'number' ||
      typeof fp.point?.y !== 'number' ||
      typeof fp.point?.z !== 'number' ||
      typeof fp.normal?.x !== 'number' ||
      typeof fp.normal?.y !== 'number' ||
      typeof fp.normal?.z !== 'number' ||
      !Number.isFinite(fp.point.x) ||
      !Number.isFinite(fp.point.y) ||
      !Number.isFinite(fp.point.z) ||
      !Number.isFinite(fp.normal.x) ||
      !Number.isFinite(fp.normal.y) ||
      !Number.isFinite(fp.normal.z)
    ) {
      events.emit('actionApplied', { type: action.type });
      return;
    }
  }
  // Add mode consumes soil; an empty counter fails the whole stroke bit.
  if (action.mode === 'add' && player.soil <= 0) {
    events.emit('actionApplied', { type: action.type });
    return;
  }
  const field = baseFieldFor(world, planet.id);
  const local = {
    x: action.center.x - planet.center.x,
    y: action.center.y - planet.center.y,
    z: action.center.z - planet.center.z,
  };
  const plane: FlattenPlane | undefined = action.flattenPlane
    ? {
        point: {
          x: action.flattenPlane.point.x - planet.center.x,
          y: action.flattenPlane.point.y - planet.center.y,
          z: action.flattenPlane.point.z - planet.center.z,
        },
        normal: { ...action.flattenPlane.normal },
      }
    : undefined;
  // Drill tier (M12) is derived from the selected backpack slot on every
  // stroke: switching slots is immediate and a stale HUD/save value can
  // never gate an edit. Mk3 adds its 30% speed to dig strokes only.
  const hardness = toolHardnessFor(world, entity.id);
  const strength = action.strength * (action.mode === 'dig' ? digSpeedMult(world, entity.id) : 1);
  const outcome = world.terrainEdits.applySphere(
    planet,
    field.density,
    local,
    radius,
    strength,
    action.mode,
    {
      maxHardness: hardness,
      hardnessAt: (x, y, z) => layerAt(planet, x, y, z).hardness,
      flattenPlane: plane,
      // Digging earns soil; adding/flattening may only flip what the
      // counter covers (never spend what the player does not have).
      soilBudget: action.mode === 'dig' ? undefined : player.soil,
    },
  );
  // Keep the saved/displayed hardness in sync with what this stroke used.
  player.toolHardness = hardness;
  player.soil = Math.min(SOIL_MAX, Math.max(0, player.soil + outcome.gained - outcome.spent));
  if (outcome.blocked) player.lastTooHard = world.time;
  // Mining: a dig stroke that actually moved terrain and overlaps a node
  // shakes one charge loose as a physical item beside it. Fully blocked
  // (too-hard) strokes mine nothing. Add/flatten never mine.
  if (action.mode === 'dig' && outcome.keys.length > 0) {
    mineNodes(world, planet.id, action.center, radius);
  }
  if (outcome.keys.length > 0) {
    events.emit('terrainEdited', { planetId: planet.id, keys: outcome.keys });
  }
  events.emit('actionApplied', { type: action.type });
}
