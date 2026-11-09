import { MAX_TICKS_PER_FRAME, SIM_DT } from '../core/constants.js';
import { events } from '../core/events.js';
import { length } from '../core/math.js';
import { SELA } from '../planets/configs/sela.js';
import { layerAt } from '../terrain/density.js';
import { getOrigin, maybeShiftOrigin, toLocal } from '../render/floatingOrigin.js';
import { Renderer } from '../render/Renderer.js';
import { FreeFlyCamera } from '../player/freeFlyCamera.js';
import { World } from '../sim/world.js';
import { DebugOverlay } from '../ui/debugOverlay.js';

// Game owns World + Renderer and wires the fixed-timestep loop:
// sim advances at 30 Hz with an accumulator; rendering interpolates
// every animation frame (M00: camera state is render-side, alpha unused yet).

export class Game {
  readonly world: World;
  readonly renderer: Renderer;
  readonly flyCamera = new FreeFlyCamera();
  readonly overlay = new DebugOverlay();

  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private lastTickMs = 0;
  private originShifts = 0;
  private flySpeed = 60;
  private readonly unsubscribeOriginShifted: () => void;

  constructor(canvas: HTMLCanvasElement, seed: number) {
    this.world = new World(seed);
    this.renderer = new Renderer(canvas, seed);
    this.flyCamera.speed = 60;
    this.flyCamera.attach(canvas, (speed) => {
      this.flySpeed = speed;
    });
    this.flySpeed = this.flyCamera.speed;

    window.addEventListener('keydown', this.handleGlobalKey);
    this.unsubscribeOriginShifted = events.on('originShifted', () => {
      this.originShifts += 1;
    });
  }

  private handleGlobalKey = (e: KeyboardEvent): void => {
    if (e.code === 'F1') {
      e.preventDefault();
      this.overlay.toggle();
    } else if (e.code === 'F3') {
      e.preventDefault();
      this.flyCamera.enabled = !this.flyCamera.enabled;
    }
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (now: number): void => {
      if (!this.running) return;
      this.frame(now);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('keydown', this.handleGlobalKey);
    this.unsubscribeOriginShifted();
    this.flyCamera.detach();
    this.overlay.dispose();
    this.renderer.dispose();
  }

  private frame(now: number): void {
    let frameDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameDt > 0.25) frameDt = 0.25;

    // FPS counter.
    this.fpsFrames += 1;
    this.fpsTime += frameDt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    // Fixed-timestep sim (cap catch-up so a hitch can't spiral).
    this.accumulator += frameDt;
    let ticks = 0;
    while (this.accumulator >= SIM_DT && ticks < MAX_TICKS_PER_FRAME) {
      const t0 = performance.now();
      this.world.tick(SIM_DT);
      this.lastTickMs = performance.now() - t0;
      this.accumulator -= SIM_DT;
      ticks += 1;
    }
    if (ticks === MAX_TICKS_PER_FRAME) {
      this.accumulator = 0;
    }

    // Camera + floating origin. Chunk meshes are positioned when added and
    // re-synced on origin shifts only (per-frame syncAll would cost O(N)
    // every frame against the 4 ms terrain budget).
    this.flyCamera.update(frameDt);
    const shift = maybeShiftOrigin(this.flyCamera.position);
    if (shift) {
      this.renderer.applyOriginShift(shift);
    }
    const local = toLocal(this.flyCamera.position);
    this.flyCamera.applyToCamera(this.renderer.camera, local);
    this.renderer.render();

    // M01 debug: nearest planet, depth below its surface, layer at camera.
    const rel = {
      x: this.flyCamera.position.x - SELA.center.x,
      y: this.flyCamera.position.y - SELA.center.y,
      z: this.flyCamera.position.z - SELA.center.z,
    };
    const depth = SELA.radius - length(rel);
    this.overlay.update({
      fps: this.fps,
      tickMs: this.lastTickMs,
      cameraWorld: { ...this.flyCamera.position },
      origin: getOrigin(),
      drawCalls: this.renderer.renderer.info.render.calls,
      flySpeed: this.flySpeed,
      originShifts: this.originShifts,
      planet: SELA.name,
      depthM: depth,
      layer: layerAt(SELA, rel.x, rel.y, rel.z).name,
      chunksLoaded: this.renderer.preview.loaded,
      chunksTotal: this.renderer.preview.total,
      chunksAdded: this.renderer.preview.added,
      chunksEmpty: this.renderer.preview.empty,
      workerQueue: this.renderer.pool.queuedJobs,
    });
  }
}
