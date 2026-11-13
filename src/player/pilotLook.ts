// Pilot-mode pointer and free-look state (M14), split out of PlayerInput to
// keep that file under the 400-line rule. Pointer lock makes mouse movement
// steer the ship; holding RMB diverts movement into this buffer so the chase
// camera can look around without changing the ship's heading.

import { CAMERA_LOOK_RADIANS_PER_PIXEL } from '../core/constants.js';
import { getSettings } from '../core/settings.js';

export class PilotLook {
  private canvas: HTMLCanvasElement | null = null;
  private active = false;
  private freeX = 0;
  private freeY = 0;
  private steeringYaw = 0;
  private steeringPitch = 0;

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
  }

  detach(): void {
    this.reset();
    this.canvas = null;
  }

  isActive(): boolean {
    return this.active;
  }

  /** Enter/leave pilot mode, taking or returning the pointer lock. */
  setActive(enabled: boolean): void {
    if (this.active === enabled) return;
    this.active = enabled;
    this.steeringYaw = 0;
    this.steeringPitch = 0;
    this.freeX = 0;
    this.freeY = 0;
    if (enabled) this.requestLock();
    else this.releaseLock();
  }

  /** Ask for pointer lock from a user gesture (click/E/board). */
  requestLock(): void {
    if (!this.canvas || document.pointerLockElement === this.canvas) return;
    try {
      const result = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      result?.catch?.(() => {});
    } catch {
      // Pointer lock unavailable; the free cursor remains usable.
    }
  }

  private releaseLock(): void {
    if (!this.canvas || document.pointerLockElement !== this.canvas) return;
    try {
      document.exitPointerLock();
    } catch {
      // Pointer lock unavailable; nothing to release.
    }
  }

  /** Accumulate one RMB mouse delta (camera-only). */
  addLook(dx: number, dy: number): void {
    this.freeX += dx;
    this.freeY += dy;
  }

  /** Flight mouse history must not saturate at the on-foot orbit limit.
   * The simulation limits actual nose pitch after applying these deltas. */
  steer(dx: number, dy: number): void {
    const settings = getSettings();
    const sensitivity = CAMERA_LOOK_RADIANS_PER_PIXEL * settings.sensitivity;
    this.steeringYaw -= dx * sensitivity;
    this.steeringPitch -= dy * sensitivity * (settings.invertY ? -1 : 1);
  }

  steering(): { yaw: number; pitch: number } {
    return { yaw: this.steeringYaw, pitch: this.steeringPitch };
  }

  /** Consume the accumulated free-look deltas (CSS pixels). */
  consume(): { dx: number; dy: number } {
    const delta = { dx: this.freeX, dy: this.freeY };
    this.freeX = 0;
    this.freeY = 0;
    return delta;
  }

  resetDeltas(): void {
    this.freeX = 0;
    this.freeY = 0;
  }

  /** Full teardown (detach): no pointer-lock request on the dead canvas. */
  reset(): void {
    this.active = false;
    this.steeringYaw = 0;
    this.steeringPitch = 0;
    this.freeX = 0;
    this.freeY = 0;
  }
}
