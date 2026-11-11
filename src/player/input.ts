// Player keyboard/mouse state, sampled once per sim tick by Game and sent
// as a playerInput Action (ARCHITECTURE.md hard rule 2). Pointer lock on
// click; drag fallback like the free-fly camera. F3 is owned by Game.

import { BACKPACK_SLOTS } from '../core/constants.js';

export class PlayerInput {
  private keys = new Set<string>();
  private mouseButtons = new Set<number>();
  private jumpQueued = false;
  private headlampQueued = false;
  private interactQueued = false;
  private dropQueued = false;
  private tetherQueued = false;
  private selectQueued: number | null = null;
  private enabled = true;
  private canvas: HTMLCanvasElement | null = null;
  private lookTarget: { addLook: (dx: number, dy: number) => void } | null = null;
  private zoomTarget: { zoom: (delta: number) => void } | null = null;
  private radiusTarget: { adjustRadius: (deltaY: number) => void } | null = null;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  attach(
    canvas: HTMLCanvasElement,
    lookTarget: { addLook: (dx: number, dy: number) => void },
    zoomTarget: { zoom: (delta: number) => void },
    radiusTarget?: { adjustRadius: (deltaY: number) => void },
  ): void {
    this.canvas = canvas;
    this.lookTarget = lookTarget;
    this.zoomTarget = zoomTarget;
    this.radiusTarget = radiusTarget ?? null;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    canvas.addEventListener('mousedown', this.handleMouseDown);
    canvas.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('blur', this.handleBlur);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  detach(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.canvas?.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas?.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
    window.removeEventListener('blur', this.handleBlur);
    this.canvas?.removeEventListener('wheel', this.handleWheel);
    this.keys.clear();
    this.mouseButtons.clear();
    this.canvas = null;
  }

  /** Active only when some look/zoom target is attached (third-person mode). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.keys.clear();
    this.mouseButtons.clear();
    this.jumpQueued = false;
    this.headlampQueued = false;
    this.interactQueued = false;
    this.dropQueued = false;
    this.tetherQueued = false;
    this.selectQueued = null;
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

  /** Edge-triggered: true once per L keydown (headlamp toggle). */
  consumeHeadlampToggle(): boolean {
    const toggle = this.headlampQueued;
    this.headlampQueued = false;
    return toggle;
  }

  /** Edge-triggered: true once per E keydown (pick up the aimed item). */
  consumeInteract(): boolean {
    const interact = this.interactQueued;
    this.interactQueued = false;
    return interact;
  }

  /** Edge-triggered: true once per Q keydown (drop the selected slot). */
  consumeDrop(): boolean {
    const drop = this.dropQueued;
    this.dropQueued = false;
    return drop;
  }

  /** Edge-triggered: true once per T keydown (place a tether post). */
  consumeTether(): boolean {
    const tether = this.tetherQueued;
    this.tetherQueued = false;
    return tether;
  }

  /** Edge-triggered: slot index once per Digit1..8 keydown. */
  consumeSelect(): number | null {
    const select = this.selectQueued;
    this.selectQueued = null;
    return select;
  }

  /** Terrain tool buttons: left = dig, right = add, F or middle = flatten. */
  toolButtons(): { dig: boolean; add: boolean; flatten: boolean } {
    return {
      dig: this.mouseButtons.has(0),
      add: this.mouseButtons.has(2),
      flatten: this.keys.has('KeyF') || this.mouseButtons.has(1),
    };
  }

  private handleBlur = (): void => {
    this.keys.clear();
    this.mouseButtons.clear();
    this.dragging = false;
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Headlamp toggle works even when input is disabled (fly mode): the
    // lamp rides the camera, so it stays useful there.
    if (e.code === 'KeyL') {
      if (!e.repeat) this.headlampQueued = true;
      return;
    }
    if (!this.enabled) return;
    if (e.code.startsWith('F')) return;
    if (e.code === 'KeyE') {
      if (!e.repeat) this.interactQueued = true;
      return;
    }
    if (e.code === 'KeyQ') {
      if (!e.repeat) this.dropQueued = true;
      return;
    }
    if (e.code === 'KeyT') {
      if (!e.repeat) this.tetherQueued = true;
      return;
    }
    if (e.code.startsWith('Digit')) {
      const slot = Number(e.code.slice(5)) - 1;
      if (Number.isInteger(slot) && slot >= 0 && slot < BACKPACK_SLOTS && !e.repeat) {
        this.selectQueued = slot;
      }
      return;
    }
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
    this.mouseButtons.add(e.button);
    // Middle click would autoscroll the page: suppress it (it is flatten).
    if (e.button === 1) e.preventDefault();
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private handleContextMenu = (e: MouseEvent): void => {
    // Right mouse is the add brush, not a menu.
    e.preventDefault();
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

  private handleMouseUp = (e: MouseEvent): void => {
    this.mouseButtons.delete(e.button);
    this.dragging = false;
  };

  private handleWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    // Ctrl+wheel resizes the terrain brush instead of zooming the camera.
    if (e.ctrlKey) {
      this.radiusTarget?.adjustRadius(e.deltaY);
      return;
    }
    this.zoomTarget?.zoom(e.deltaY);
  };
}
