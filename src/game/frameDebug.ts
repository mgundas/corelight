// Per-frame debug-overlay update (split from Game.ts). Skips all stats work
// while the overlay is hidden; read-only.

import type { Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import type { ToolAim } from '../player/terrainTool.js';
import type { Renderer } from '../render/Renderer.js';
import type { EntityId } from '../sim/entities.js';
import type { TerrainColliders } from '../sim/physics/terrainColliders.js';
import type { World } from '../sim/world.js';
import type { DebugOverlay } from '../ui/debugOverlay.js';
import { updateDebugOverlay } from './debugStats.js';

export interface FrameDebugArgs {
  world: World;
  planets: PlanetConfig[];
  renderer: Renderer;
  overlay: DebugOverlay;
  colliders: TerrainColliders;
  playerId: EntityId | null;
  toolAim: ToolAim;
  toolRadius: number;
  toolMode: 'cursor' | 'deform';
  brushMode: 'dig' | 'add';
  fps: number;
  tickMs: number;
  flySpeed: number;
  originShifts: number;
  activePos: Vec3d;
  depthBelowM: number;
}

export function updateFrameDebug(args: FrameDebugArgs): void {
  if (!args.overlay.isVisible()) return;
  updateDebugOverlay({
    world: args.world,
    planets: args.planets,
    renderer: args.renderer,
    overlay: args.overlay,
    colliders: args.colliders,
    playerId: args.playerId,
    toolAim: args.toolAim,
    toolRadius: args.toolRadius,
    toolMode: args.toolMode,
    brushMode: args.brushMode,
    fps: args.fps,
    tickMs: args.tickMs,
    flySpeed: args.flySpeed,
    originShifts: args.originShifts,
    activePos: args.activePos,
    depthBelowM: args.depthBelowM,
  });
}
