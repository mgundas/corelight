import type { Vec3d } from '../core/math.js';

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
}

export class DebugOverlay {
  private el: HTMLDivElement;
  private visible = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'debug-overlay';
    this.el.style.display = 'none';
    document.body.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    this.el.remove();
  }

  update(stats: OverlayStats): void {
    if (!this.visible) return;
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
        stats.toolRadius !== undefined ? `r ${stats.toolRadius.toFixed(1)}` : null,
        stats.toolInfo !== undefined ? stats.toolInfo : null,
      ].filter((part) => part !== null);
      tool = `\ntool: ${parts.join(' | ')}${stats.tooHard ? '  TOO HARD!' : ''}`;
    }
    this.el.textContent =
      `FPS: ${stats.fps.toFixed(0)} | tick: ${stats.tickMs.toFixed(2)} ms | draws: ${stats.drawCalls}\n` +
      `cam: ${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.z.toFixed(1)}\n` +
      `origin: ${o.x.toFixed(0)}, ${o.y.toFixed(0)}, ${o.z.toFixed(0)} (shifts: ${stats.originShifts})\n` +
      `fly speed: ${stats.flySpeed.toFixed(1)} m/s${sun}${place}${player}${tool}${terrain}`;
  }
}
