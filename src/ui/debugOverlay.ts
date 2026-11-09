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
  chunksLoaded?: number;
  chunksTotal?: number;
  chunksAdded?: number;
  workerQueue?: number;
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
    if (stats.chunksTotal !== undefined) {
      terrain =
        `\nchunks: ${stats.chunksAdded ?? 0} meshes / ${stats.chunksLoaded ?? 0} done of ${stats.chunksTotal} (queue ${stats.workerQueue ?? 0})`;
    }
    this.el.textContent =
      `FPS: ${stats.fps.toFixed(0)} | tick: ${stats.tickMs.toFixed(2)} ms | draws: ${stats.drawCalls}\n` +
      `cam: ${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.z.toFixed(1)}\n` +
      `origin: ${o.x.toFixed(0)}, ${o.y.toFixed(0)}, ${o.z.toFixed(0)} (shifts: ${stats.originShifts})\n` +
      `fly speed: ${stats.flySpeed.toFixed(1)} m/s${terrain}`;
  }
}
