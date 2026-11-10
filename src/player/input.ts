// Player keyboard/mouse state, sampled once per sim tick by Game and sent
// as a playerInput Action (ARCHITECTURE.md hard rule 2). Pointer lock on
// click; drag fallback like the free-fly camera. F3 is owned by Game.

export class PlayerInput {
  private keys = new Set<string>();
  private jumpQueued = false;
  private enabled = true;
  private canvas: HTMLCanvasElement | null = null;
  private lookTarget: { addLook: (dx: number, dy: number) => void } | null = null;
  private zoomTarget: { zoom: (delta: number) => void } | null = null;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  attach(
    canvas: HTMLCanvasElement,
    lookTarget: { addLook: (dx: number, dy: number) => void },
    zoomTarget: { zoom: (delta: number) => void },
  ): void {
    this.canvas = canvas;
    this.lookTarget = lookTarget;
    this.zoomTarget = zoomTarget;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    canvas.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('blur', this.handleBlur);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  detach(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.canvas?.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
    window.removeEventListener('blur', this.handleBlur);
    this.canvas?.removeEventListener('wheel', this.handleWheel);
    this.keys.clear();
    this.canvas = null;
  }

  /** Active only when some look/zoom target is attached (third-person mode). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.keys.clear();
    this.jumpQueued = false;
    this.dragging = false;
  }

  /** Strafe/forward intent in [-1, 1]. */
  move(): { x: number; z: number } {
    let x = 0;
    let z = 0;
    if (this.keys.has('KeyW')) z += 1;
    if (this.keys.has('KeyS')) z -= 1;
    if (this.keys.has('KeyD')) x += 1;
    if (this.keys.has('KeyA')) x -= 1;
    return { x, z };
  }

  sprint(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** Edge-triggered: true once per Space keydown. */
  consumeJump(): boolean {
    const jump = this.jumpQueued;
    this.jumpQueued = false;
    return jump;
  }

  private handleBlur = (): void => {
    this.keys.clear();
    this.dragging = false;
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    if (e.code.startsWith('F')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) this.jumpQueued = true;
      this.keys.add(e.code);
      return;
    }
    this.keys.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (!this.enabled) return;
    if (document.pointerLockElement !== this.canvas) {
      try {
        const result = this.canvas?.requestPointerLock() as unknown as Promise<void> | undefined;
        result?.catch?.(() => {});
      } catch {
        // Pointer lock unavailable — drag fallback still works.
      }
    }
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.enabled) return;
    let dx = 0;
    let dy = 0;
    if (document.pointerLockElement === this.canvas) {
      dx = e.movementX;
      dy = e.movementY;
    } else if (this.dragging) {
      dx = e.clientX - this.lastX;
      dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    } else {
      return;
    }
    this.lookTarget?.addLook(dx, dy);
  };

  private handleMouseUp = (): void => {
    this.dragging = false;
  };

  private handleWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    this.zoomTarget?.zoom(e.deltaY);
  };
}
