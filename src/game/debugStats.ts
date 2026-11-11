// Debug-overlay assembly (M06). Split out of Game to keep both files under
// the 400-line hard rule: pure read-only assembly of render/sim state into
// the overlay payload. The overlay no-ops while hidden, so the caller skips
// this entirely in that case (mesh counts and layer lookups are not free).

import { TOO_HARD_INDICATOR_S } from '../core/constants.js';
import { length, sub, type Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { getOrigin } from '../render/floatingOrigin.js';
import type { Renderer } from '../render/Renderer.js';
import type { TerrainColliders } from '../sim/physics/terrainColliders.js';
import { timeOfDay } from '../sim/systems/sun.js';
import { layerAt } from '../terrain/density.js';
import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';
import type { DebugOverlay } from '../ui/debugOverlay.js';
import type { ToolAim } from '../player/terrainTool.js';
import { findFollowed, nearestPlanet } from './environment.js';

export interface DebugStatsContext {
  world: World;
  planets: PlanetConfig[];
  renderer: Renderer;
  overlay: DebugOverlay;
  colliders: TerrainColliders;
  playerId: EntityId | null;
  toolAim: ToolAim;
  toolRadius: number;
  fps: number;
  tickMs: number;
  flySpeed: number;
  originShifts: number;
  activePos: Vec3d;
  depthBelowM: number;
}

export function updateDebugOverlay(ctx: DebugStatsContext): void {
  const followed = findFollowed(ctx.world, ctx.planets, ctx.playerId);
  const planet = followed?.planet ?? nearestPlanet(ctx.planets, ctx.activePos);
  const focus = followed?.position ?? ctx.activePos;
  const rel = {
    x: focus.x - planet.center.x,
    y: focus.y - planet.center.y,
    z: focus.z - planet.center.z,
  };
  const depth = planet.radius - length(rel);
  const stats = ctx.renderer.streamStats();
  const lod = stats.perLevel
    .map((count, level) => (count ? `L${level}:${count}` : null))
    .filter((part) => part !== null)
    .join(' ');
  const player = ctx.playerId ? ctx.world.entities.get(ctx.playerId) : undefined;
  const playerComp = player?.components.player;
  // Tool readout: layer + hardness under the brush cursor, soil counter,
  // and the too-hard indicator (freshly blocked dig, <1.5 s ago).
  let toolInfo: string | undefined;
  if (ctx.toolAim.hit && ctx.toolAim.planet) {
    const hitLocal = sub(ctx.toolAim.hit, ctx.toolAim.planet.center);
    const toolLayer = layerAt(ctx.toolAim.planet, hitLocal.x, hitLocal.y, hitLocal.z);
    toolInfo = `${toolLayer.name} h${toolLayer.hardness}`;
  }
  ctx.overlay.update({
    fps: ctx.fps,
    tickMs: ctx.tickMs,
    cameraWorld: { ...ctx.activePos },
    origin: getOrigin(),
    drawCalls: ctx.renderer.renderer.info.render.calls,
    flySpeed: ctx.flySpeed,
    originShifts: ctx.originShifts,
    timeOfDay: timeOfDay(ctx.world),
    belowSurfaceM: ctx.depthBelowM,
    planet: planet.name,
    depthM: depth,
    layer: layerAt(planet, rel.x, rel.y, rel.z).name,
    lodCounts: lod,
    pendingJobs: stats.pending,
    cacheSize: stats.cacheSize,
    emptyChunks: stats.empty,
    desiredChunks: stats.desired,
    playerWorld: player ? { ...player.position } : undefined,
    grounded: player?.components.player?.grounded,
    pendingColliders: ctx.colliders.pendingCount,
    loadedColliders: ctx.colliders.loadedCount,
    soil: playerComp?.soil,
    toolRadius: ctx.toolRadius,
    toolInfo,
    tooHard:
      playerComp !== undefined &&
      ctx.world.time - playerComp.lastTooHard < TOO_HARD_INDICATOR_S,
  });
}
