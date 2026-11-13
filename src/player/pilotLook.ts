// Pilot-mode pointer and free-look state (M14), split out of PlayerInput to
// keep that file under the 400-line rule. Pointer lock makes mouse movement
// steer the ship; holding RMB diverts movement into this buffer so the chase
// camera can look around without changing the ship's heading.

export class PilotLook {
  private canvas: HTMLCanvasElement | null = null;
  private active = false;
  private freeX = 0;
  private freeY = 0;

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
    this.freeX = 0;
    this.freeY = 0;
  }
}
