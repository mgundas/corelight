// Per-frame entity + HUD sync (M07/M08). Split out of Game.ts to keep both
// files under the 400-line hard rule: backpack frame, oxygen status, entity
// views, HUD slot bar and the terrain brush preview. Pure frame wiring (no
// sim mutation); all state changes still go through dispatched Actions.

import type { Vec3d } from '../core/math.js';
import type { Renderer } from '../render/Renderer.js';
import type { World } from '../sim/world.js';
import type { EntityId } from '../sim/entities.js';
import type { ToolAim } from '../player/terrainTool.js';
import type { Hud } from '../ui/hud.js';
import type { PlacementMode } from './placement.js';
import type { CableMode } from './cableMode.js';
import type { ToolMode } from './toolMode.js';
import { carriedPlaceable, placementCheckFor } from './placement.js';
import { backpackFrame } from './backpackWiring.js';
import { oxygenStatusFor } from './oxygenStatus.js';
import { powerStatusFor } from './powerStatus.js';
import { interactPrompt } from './prompts.js';
import { upAt } from '../sim/physics/frames.js';

export interface FrameHudDeps {
  renderer: Renderer;
  hud: Hud;
  world: World;
  playerId: EntityId | null;
  flying: boolean;
  focusWorld: Vec3d;
  aim: ToolAim;
  placement: PlacementMode;
  cable?: CableMode;
  toolMode: ToolMode;
  /** Loose item under the cursor (cursor mode), else null. */
  cursorItemId: EntityId | null;
  /** Empty structure under the cursor (cursor mode), else null. */
  cursorPackId: EntityId | null;
}

/** Render synced entity views and refresh the HUD slot bar + oxygen meter. */
export function updateFrameHud(deps: FrameHudDeps): void {
  const activePlayer = deps.flying ? null : deps.playerId;
  const frame = backpackFrame(deps.world, activePlayer, deps.flying);
  const o2 = oxygenStatusFor(deps.world, activePlayer);
  const power = powerStatusFor(deps.world, activePlayer);
  deps.renderer.renderEntities(
    deps.world.entities.values(),
    deps.focusWorld,
    frame.carriedItemIds,
    frame.frontCarryItemId,
    deps.world.sunDirection,
  );
  deps.hud.update({
    slots: frame.slotDefs,
    selectedSlot: frame.selectedSlot,
    soil: frame.soil,
    prompt: interactPrompt(
      deps.world,
      activePlayer,
      deps.aim,
      deps.placement,
      deps.cable,
      deps.cursorItemId,
      deps.cursorPackId,
    ),
    oxygen: o2?.oxygen ?? 100,
    onNetwork: o2?.onNetwork ?? true,
    heat: o2?.heat ?? false,
    cold: o2?.cold ?? false,
    habitatHint: o2?.habitat ?? null,
    deathHint: o2?.deathMarker ?? null,
    power: power?.status ?? null,
    toolMode: deps.toolMode.active ? 'deform' : 'cursor',
    brushMode: deps.toolMode.brush,
    drillTier: frame.drillTier,
  });
}

export interface PlacementGhostDeps {
  renderer: Renderer;
  world: World;
  playerId: EntityId | null;
  flying: boolean;
  aim: ToolAim;
  placement: PlacementMode;
}

/** Show the placement ghost + validity colour for the active mode. */
export function updatePlacementGhost(deps: PlacementGhostDeps): void {
  if (deps.flying || !deps.playerId || !deps.placement.isActive() || !deps.aim.planet) {
    deps.renderer.setPlacementGhost(null, null, null, false);
    return;
  }
  const carried = carriedPlaceable(deps.world, deps.playerId);
  if (!carried) {
    deps.renderer.setPlacementGhost(null, null, null, false);
    return;
  }
  const check = placementCheckFor(deps.world, deps.playerId, deps.aim);
  const up = deps.aim.hit ? upAt(deps.aim.planet, deps.aim.hit) : { x: 0, y: 1, z: 0 };
  deps.renderer.setPlacementGhost(
    carried.placeable.id,
    check.position,
    up,
    check.ok,
    check.rotation,
  );
}

export interface ToolPreviewDeps {
  renderer: Renderer;
  flying: boolean;
  hit: Vec3d | null;
  radius: number;
}

/** Translucent brush sphere at the aim point (hidden in fly mode or off-target). */
export function updateToolPreview(deps: ToolPreviewDeps): void {
  deps.renderer.setToolPreview(deps.flying || !deps.hit ? null : deps.hit, deps.radius);
}
