// Per-tick input dispatch (M09 split): headlamp, backpack keys, E/Tab
// interaction, player movement and either placement confirmation or the
// terrain tool. Extracted from Game.frame to keep Game under the 400-line
// rule and to make the priority order explicit in one place.

import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';
import type { PlayerInput } from '../player/input.js';
import type { TerrainTool, ToolAim } from '../player/terrainTool.js';
import type { PlacementMode } from './placement.js';
import { tickBackpackInput } from './backpackWiring.js';
import { tickInteraction } from './interactWiring.js';

export interface TickInputDeps {
  world: World;
  playerId: EntityId | null;
  input: PlayerInput;
  rig: { yaw: number; pitch: number };
  tool: TerrainTool;
  toolAim: ToolAim;
  toolButtons: { dig: boolean; add: boolean; flatten: boolean };
  toolActive: boolean;
  nowMs: number;
  flying: boolean;
  uiOpen: boolean;
  placement: PlacementMode;
  openStation(stationId: EntityId): void;
  togglePrinter(): void;
}

/** Dispatch one sim tick's worth of input as Actions (call before tick). */
export function dispatchTickInput(deps: TickInputDeps): void {
  if (deps.input.consumeHeadlampToggle() && deps.playerId) {
    deps.world.dispatch({ type: 'toggleHeadlamp', playerId: deps.playerId });
  }
  const canAct = !deps.flying && deps.playerId !== null && !deps.uiOpen;
  // All edge queues drain every tick so nothing fires late.
  tickBackpackInput(deps.world, deps.playerId, deps.input, canAct);
  tickInteraction({
    world: deps.world,
    playerId: deps.playerId,
    input: deps.input,
    canAct,
    aim: deps.toolAim,
    placement: deps.placement,
    openStation: deps.openStation,
    togglePrinter: deps.togglePrinter,
  });
  if (!canAct || !deps.playerId) return;
  const playerId = deps.playerId;
  deps.world.dispatch({
    type: 'playerInput',
    playerId,
    move: deps.input.move(),
    jump: deps.input.consumeJump(),
    sprint: deps.input.sprint(),
    lookYaw: deps.rig.yaw,
    lookPitch: deps.rig.pitch,
  });
  // Placement consumes the click; the terrain tool must not also fire on
  // the same tick (a placed platform would otherwise dig its own ground).
  const request = deps.placement.tick(
    deps.world,
    playerId,
    deps.toolAim,
    deps.toolButtons.dig,
    deps.toolButtons.add,
  );
  if (request) {
    deps.world.dispatch({
      type: 'placePlaceable',
      playerId,
      placeableId: request.placeableId,
      position: request.position,
    });
    return;
  }
  if (deps.placement.isActive()) return;
  if (deps.toolActive) {
    const edit = deps.tool.update(deps.nowMs, playerId, deps.toolButtons, deps.toolAim);
    if (edit) deps.world.dispatch(edit);
  }
}
