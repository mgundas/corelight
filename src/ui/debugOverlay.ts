// F1 debug overlay controller (React port). Formats the stats snapshot and
// writes the zustand store; DebugOverlayView renders it.

import type { Vec3d } from '../core/math.js';
import { resetOverlayStore, useOverlayStore } from './stores/overlayStore.js';

// F1 debug overlay: FPS, sim tick time, camera world pos, origin, draw calls.

export interface OverlayStats {
  fps: number;
  tickMs: number;
  cameraWorld: Vec3d;
  origin: Vec3d;
  drawCalls: number;
  flySpeed: number;
  originShifts: number;
  planet?: string;
  depthM?: number;
  layer?: string;
  lodCounts?: string;
  pendingJobs?: number;
  cacheSize?: number;
  emptyChunks?: number;
  desiredChunks?: number;
  playerWorld?: Vec3d;
  grounded?: boolean;
  pendingColliders?: number;
  loadedColliders?: number;
  /** Fractional time of day in [0, 1): 0 = sunrise, 0.25 = noon. */
  timeOfDay?: number;
  /** Depth below the unedited surface at the camera (meters, sim formula). */
  belowSurfaceM?: number;
  soil?: number;
  toolRadius?: number;
  /** Layer + hardness under the tool cursor, e.g. "crust h2". */
  toolInfo?: string;
  tooHard?: boolean;
  /** Suit oxygen 0..100 (M08). */
  oxygen?: number;
  /** Tether graph: live posts / total posts (M08). */
  tetherLive?: number;
  tetherTotal?: number;
  /** Terrain tool equipped (Q) and add/deform sub-mode (X). */
  toolMode?: 'cursor' | 'deform';
  brushMode?: 'dig' | 'add';
}

/** Pure formatter (unit-testable; no DOM). */
export function formatOverlayStats(stats: OverlayStats): string {
  const c = stats.cameraWorld;
  const o = stats.origin;
  let terrain = '';
  if (stats.lodCounts !== undefined) {
    terrain =
      `\nchunks ${stats.lodCounts} (desired ${stats.desiredChunks ?? 0}, pending ${stats.pendingJobs ?? 0}, cache ${stats.cacheSize ?? 0}, empty ${stats.emptyChunks ?? 0})`;
  }
  let place = '';
  if (stats.planet !== undefined && stats.depthM !== undefined && stats.layer !== undefined) {
    place = `\n${stats.planet}: depth ${stats.depthM.toFixed(1)} m, layer ${stats.layer}`;
  }
  let player = '';
  if (stats.playerWorld !== undefined) {
    const p = stats.playerWorld;
    player =
      `\nplayer: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}` +
      (stats.grounded !== undefined ? ` grounded: ${stats.grounded ? 'yes' : 'no'}` : '') +
      (stats.pendingColliders !== undefined ? ` colliders: ${stats.loadedColliders ?? 0} +${stats.pendingColliders} pending` : '');
  }
  let sun = '';
  if (stats.timeOfDay !== undefined || stats.belowSurfaceM !== undefined) {
    const sunParts = [
      stats.timeOfDay !== undefined ? `time ${stats.timeOfDay.toFixed(2)}` : null,
      stats.belowSurfaceM !== undefined ? `below surface ${stats.belowSurfaceM.toFixed(1)} m` : null,
    ].filter((part) => part !== null);
    sun = `\nsun: ${sunParts.join(' | ')}`;
  }
  let tool = '';
  if (stats.soil !== undefined || stats.toolRadius !== undefined || stats.toolInfo !== undefined) {
    const parts = [
      stats.soil !== undefined ? `soil ${stats.soil}` : null,
      stats.toolMode !== undefined ? `mode ${stats.toolMode === 'deform' ? (stats.brushMode ?? 'dig') : 'cursor'}` : null,
      stats.toolRadius !== undefined ? `r ${stats.toolRadius.toFixed(1)}` : null,
      stats.toolInfo !== undefined ? stats.toolInfo : null,
    ].filter((part) => part !== null);
    tool = `\ntool: ${parts.join(' | ')}${stats.tooHard ? '  TOO HARD!' : ''}`;
  }
  let o2 = '';
  if (stats.oxygen !== undefined || stats.tetherTotal !== undefined) {
    const o2Parts = [
      stats.oxygen !== undefined ? `o2 ${stats.oxygen.toFixed(0)}` : null,
      stats.tetherTotal !== undefined ? `tethers ${stats.tetherLive ?? 0}/${stats.tetherTotal}` : null,
    ].filter((part) => part !== null);
    o2 = `\n${o2Parts.join(' | ')}`;
  }
  return (
    `FPS: ${stats.fps.toFixed(0)} | tick: ${stats.tickMs.toFixed(2)} ms | draws: ${stats.drawCalls}\n` +
    `cam: ${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.z.toFixed(1)}\n` +
    `origin: ${o.x.toFixed(0)}, ${o.y.toFixed(0)}, ${o.z.toFixed(0)} (shifts: ${stats.originShifts})\n` +
    `fly speed: ${stats.flySpeed.toFixed(1)} m/s${sun}${place}${player}${tool}${o2}${terrain}`
  );
}

export class DebugOverlay {
  toggle(): void {
    useOverlayStore.setState((s) => ({ visible: !s.visible }));
  }

  isVisible(): boolean {
    return useOverlayStore.getState().visible;
  }

  dispose(): void {
    resetOverlayStore();
  }

  update(stats: OverlayStats): void {
    if (!this.isVisible()) return;
    useOverlayStore.setState({ text: formatOverlayStats(stats) });
  }
}
