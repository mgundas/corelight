// Per-tick input dispatch (M09/M10 split): headlamp, backpack keys, tool
// equip (Q/X), cable tool, E/Tab interaction, player movement, then either
// placement confirmation, the cable tool, the terrain tool, or grab-carry.
// Extracted from Game.frame to keep Game under the 400-line rule and make the
// priority order explicit in one place.
//
// Cursor mode (tool off): a left click grabs the loose item under the cursor;
// a second click releases it (packaged placeables resolve into placement).

import { placeableForPackageItem } from '../data/loadPlaceables.js';
import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';
import type { PlayerInput } from '../player/input.js';
import type { TerrainTool, ToolAim } from '../player/terrainTool.js';
import type { CableMode } from './cableMode.js';
import type { PlacementMode } from './placement.js';
import type { PackHold } from './packHold.js';
import type { ToolMode } from './toolMode.js';
import type { WorldRay } from './grabPick.js';
import { tickBackpackInput } from './backpackWiring.js';
import { tickInteraction } from './interactWiring.js';
import { findAimedItem } from './pickup.js';
import { findItemAlongRay } from './grabPick.js';
import { findPackableAlongRay } from './packPick.js';
import { findPlacementTarget } from './snapTarget.js';

export interface TickInputDeps {
  world: World;
  playerId: EntityId | null;
  input: PlayerInput;
  rig: { yaw: number; pitch: number };
  tool: TerrainTool;
  toolMode: ToolMode;
  toolAim: ToolAim;
  /** Screen-space ray under the cursor (null while flying). */
  cursorRay?: WorldRay | null;
  toolButtons: { primary: boolean; flatten: boolean };
  nowMs: number;
  flying: boolean;
  uiOpen: boolean;
  placement: PlacementMode;
  cable?: CableMode;
  packHold?: PackHold;
  openStation(stationId: EntityId): void;
  /** Open the research tree panel (M11; optional in focused tests). */
  openResearch?: (stationId: EntityId) => void;
  togglePrinter(): void;
}

/** Dispatch one sim tick's worth of input as Actions (call before tick). */
export function dispatchTickInput(deps: TickInputDeps): void {
  if (deps.input.consumeHeadlampToggle() && deps.playerId) {
    deps.world.dispatch({ type: 'toggleHeadlamp', playerId: deps.playerId });
  }
  // M14: a pilot owns the controls. Every on-foot edge queue still drains so
  // nothing fires late; E disembarks and Space/Shift/WASD/mouse become one
  // shuttleInput Action per tick.
  const pilotShuttleId = activePilotShuttle(deps.world, deps.playerId);
  if (pilotShuttleId) {
    // Pilot mode: pointer-locked mouse steering, RMB diverts to free-look.
    deps.input.pilotLook?.setActive(true);
    if (deps.placement.isActive()) deps.placement.cancel();
    deps.cable?.cancel();
    deps.toolMode.cancel();
    deps.packHold?.reset();
    const interact = deps.input.consumeInteract();
    deps.input.consumePrimaryClick();
    deps.input.consumeCableToggle();
    deps.input.consumeToolToggle();
    deps.input.consumeBrushToggle();
    deps.input.consumeJump();
    deps.input.consumePrinter();
    tickBackpackInput(deps.world, deps.playerId, deps.input, false);
    if (interact) {
      deps.world.dispatch({ type: 'exitShuttle', playerId: deps.playerId as EntityId });
    }
    if (!deps.flying && !deps.uiOpen && deps.playerId) {
      const move = deps.input.move();
      const look = deps.input.pilotLook?.steering?.() ?? deps.rig;
      deps.world.dispatch({
        type: 'shuttleInput',
        playerId: deps.playerId,
        shuttleId: pilotShuttleId,
        input: {
          thrust: move.z,
          yawRate: move.x,
          lift: deps.input.spaceHeld(),
          boost: deps.input.sprint(),
          lookYaw: look.yaw,
          lookPitch: look.pitch,
        },
      });
    }
    return;
  }
  deps.input.pilotLook?.setActive(false);
  const canAct = !deps.flying && deps.playerId !== null && !deps.uiOpen;
  // A grab-carry must never outlive a mode switch: stowing the tool, entering
  // placement or activating the cable tool drops the item loose (no placement).
  const releaseCarry = (): void => {
    if (!deps.playerId) return;
    const grabbed = deps.world.entities.get(deps.playerId)?.components.player?.grabbed;
    if (!grabbed) return;
    deps.world.dispatch({
      type: 'releaseGrabbed',
      playerId: deps.playerId,
      position: deps.toolAim.hit ? { ...deps.toolAim.hit } : null,
      allowPlace: false,
    });
  };
  // All edge queues drain every tick so nothing fires late.
  tickBackpackInput(deps.world, deps.playerId, deps.input, canAct);
  const interact = deps.input.consumeInteract();
  const primaryClick = deps.input.consumePrimaryClick();
  if (deps.input.consumeCableToggle() === true && deps.cable) {
    if (deps.cable.isActive()) deps.cable.cancel();
    else if (canAct) {
      deps.cable.activate();
      // Cable clicks own the mouse and E; a pending placement would fight it.
      deps.placement.cancel();
      deps.toolMode.cancel();
      releaseCarry();
    }
  }
  // Q equips/stows the terrain tool; X flips dig <-> add while equipped.
  if (deps.input.consumeToolToggle() === true && canAct) {
    deps.toolMode.toggle();
    if (deps.toolMode.active) releaseCarry();
    deps.placement.cancel();
    deps.cable?.cancel();
    deps.packHold?.reset();
  }
  if (deps.input.consumeBrushToggle() === true && deps.toolMode.active) {
    deps.toolMode.toggleBrush();
  }
  if (deps.cable?.isActive()) {
    deps.packHold?.reset();
    if (interact) {
      deps.cable.cancel();
    } else if (canAct && deps.playerId) {
      const request = deps.cable.tick(deps.world, deps.playerId, deps.toolAim, deps.toolButtons.primary);
      if (request?.type === 'connect') {
        deps.world.dispatch({
          type: 'connectCable',
          playerId: deps.playerId,
          from: request.from,
          to: request.to,
        });
      } else if (request?.type === 'disconnect') {
        deps.world.dispatch({
          type: 'disconnectCable',
          playerId: deps.playerId,
          cableId: request.cableId,
        });
      }
    }
    // Tab must still toggle while the cable tool is active; world E actions
    // are suppressed (the E edge already cancelled the tool above).
    tickInteraction({
      world: deps.world,
      playerId: deps.playerId,
      input: deps.input,
      interact: false,
      interactHeld: false,
      nowMs: deps.nowMs,
      canAct,
      aim: deps.toolAim,
      placement: deps.placement,
      openStation: deps.openStation,
      openResearch: deps.openResearch,
      togglePrinter: deps.togglePrinter,
    });
    if (!canAct || !deps.playerId) return;
    dispatchPlayerInput(deps);
    return;
  }
  tickInteraction({
    world: deps.world,
    playerId: deps.playerId,
    input: deps.input,
    interact,
    interactHeld: deps.input.isInteractHeld?.() === true,
    nowMs: deps.nowMs,
    packHold: deps.packHold,
    canAct,
    aim: deps.toolAim,
    placement: deps.placement,
    openStation: deps.openStation,
    openResearch: deps.openResearch,
    togglePrinter: deps.togglePrinter,
  });
  if (!canAct || !deps.playerId) return;
  const playerId = deps.playerId;
  dispatchPlayerInput(deps);
  // Entering placement (E on a carried package) must release a grab-carry
  // first, or the item would float while the ghost owns the click.
  if (deps.placement.isActive()) releaseCarry();
  // Placement consumes the click; the terrain tool must not also fire on
  // the same tick (a placed platform would otherwise dig its own ground).
  const request = deps.placement.tick(deps.world, playerId, deps.toolAim, deps.toolButtons.primary);
  if (request) {
    deps.world.dispatch({
      type: 'placePlaceable',
      playerId,
      placeableId: request.placeableId,
      position: request.position,
      snap: request.snap,
      slot: request.slot,
    });
    return;
  }
  if (deps.placement.isActive()) return;
  if (deps.toolMode.active) {
    const edit = deps.tool.update(
      deps.nowMs,
      playerId,
      deps.toolButtons,
      deps.toolAim,
      deps.toolMode.brush,
    );
    if (edit) deps.world.dispatch(edit);
    return;
  }
  if (primaryClick) dispatchGrabClick(deps, playerId);
}

/** Valid piloted shuttle id, or null when the player is on foot. */
export function activePilotShuttle(world: World, playerId: EntityId | null): EntityId | null {
  if (!playerId) return null;
  const player = world.entities.get(playerId);
  const id = player?.components.player?.pilotingShuttleId ?? null;
  if (!id) return null;
  const shuttle = world.entities.get(id);
  return shuttle?.kind === 'shuttle' && shuttle.components.shuttle?.pilotId === playerId ? id : null;
}

function dispatchPlayerInput(deps: TickInputDeps): void {
  if (!deps.playerId) return;
  deps.world.dispatch({
    type: 'playerInput',
    playerId: deps.playerId,
    move: deps.input.move(),
    jump: deps.input.consumeJump(),
    sprint: deps.input.sprint(),
    lookYaw: deps.rig.yaw,
    lookPitch: deps.rig.pitch,
  });
}

/** Cursor-mode click: grab the item under the cursor, or release the carry. */
function dispatchGrabClick(deps: TickInputDeps, playerId: EntityId): void {
  const player = deps.world.entities.get(playerId);
  const grabbedId = player?.components.player?.grabbed ?? null;
  if (grabbedId) {
    const itemId = deps.world.entities.get(grabbedId)?.components.item?.itemId;
    const def = itemId ? placeableForPackageItem(itemId) : undefined;
    const target = def ? findPlacementTarget(deps.world, playerId, def.id, deps.toolAim) : null;
    deps.world.dispatch({
      type: 'releaseGrabbed',
      playerId,
      position: deps.toolAim.hit ? { ...deps.toolAim.hit } : null,
      snap: target?.snap,
      slot: target?.slot,
    });
    return;
  }
  const itemId = deps.cursorRay
    ? findItemAlongRay(deps.world, playerId, deps.cursorRay)
    : findAimedItem(deps.world, playerId);
  if (itemId) {
    deps.world.dispatch({ type: 'grabItem', playerId, itemId });
    return;
  }
  // No loose item under the cursor: an empty machine/platform packs up and
  // enters placement mode, so click-move-click re-places it elsewhere.
  const packId = deps.cursorRay
    ? findPackableAlongRay(deps.world, playerId, deps.cursorRay)
    : null;
  if (!packId) return;
  const placeableId = deps.world.entities.get(packId)?.components.placeable?.placeableId;
  if (!placeableId) return;
  deps.world.dispatch({ type: 'packUpPlaced', playerId, entityId: packId });
  deps.placement.enterFromClick(placeableId);
}
