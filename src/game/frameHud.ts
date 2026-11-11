// Per-frame entity + HUD sync (M07/M08). Split out of Game.ts to keep both
// files under the 400-line hard rule: backpack frame, oxygen status, entity
// views, HUD slot bar and the terrain brush preview. Pure frame wiring (no
// sim mutation); all state changes still go through dispatched Actions.

import type { Vec3d } from '../core/math.js';
import type { Renderer } from '../render/Renderer.js';
import type { World } from '../sim/world.js';
import type { EntityId } from '../sim/entities.js';
import type { Hud } from '../ui/hud.js';
import { backpackFrame } from './backpackWiring.js';
import { oxygenStatusFor } from './oxygenStatus.js';

export interface FrameHudDeps {
  renderer: Renderer;
  hud: Hud;
  world: World;
  playerId: EntityId | null;
  flying: boolean;
  focusWorld: Vec3d;
}

/** Render synced entity views and refresh the HUD slot bar + oxygen meter. */
export function updateFrameHud(deps: FrameHudDeps): void {
  const frame = backpackFrame(deps.world, deps.flying ? null : deps.playerId, deps.flying);
  const o2 = oxygenStatusFor(deps.world, deps.flying ? null : deps.playerId);
  deps.renderer.renderEntities(deps.world.entities.values(), deps.focusWorld, frame.carriedItemIds);
  deps.hud.update({
    slots: frame.slotDefs,
    selectedSlot: frame.selectedSlot,
    soil: frame.soil,
    prompt: frame.prompt,
    oxygen: o2?.oxygen ?? 100,
    onNetwork: o2?.onNetwork ?? true,
    habitatHint: o2?.habitat ?? null,
    deathHint: o2?.deathMarker ?? null,
  });
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
