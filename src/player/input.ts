// Player keyboard/mouse state, sampled once per sim tick by Game and sent as
// a playerInput Action (ARCHITECTURE.md hard rule 2).
//
// Cursor model: the pointer is NOT captured during normal play. Hold right
// mouse (or middle mouse) to orbit the camera; only then is the pointer
// locked (fixed in place) so movement is unbounded. Right mouse has no other
// binding. Q equips the terrain tool, X toggles dig/add while equipped; with
// the tool off LMB is grab-carry (handled by Game/tickInput).

import { BACKPACK_SLOTS } from '../core/constants.js';
import { isUiKey } from './uiInput.js';
import { PilotLook } from './pilotLook.js';

export class PlayerInput {
  private keys = new Set<string>();
  private mouseButtons = new Set<number>();
  private jumpQueued = false;
  private headlampQueued = false;
  private interactQueued = false;
  private tetherQueued = false;
  private printerQueued = false;
  private cableQueued = false;
  private toolQueued = false;
  private brushQueued = false;
  private primaryQueued = false;
  private selectQueued: number | null = null;
  /** True while E is physically down (hold-to-pack). */
  private interactHeld = false;
  /** True while right/middle mouse (camera orbit) is held. */
  private orbiting = false;
  /** Pilot pointer/free-look ownership (M14); public for game wiring. */
  readonly pilotLook = new PilotLook();
  private enabled = true;
  private canvas: HTMLCanvasElement | null = null;
  private lookTarget: { addLook: (dx: number, dy: number) => void } | null = null;
  private zoomTarget: { zoom: (delta: number) => void } | null = null;
  private radiusTarget: { adjustRadius: (deltaY: number) => void } | null = null;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  /** Latest cursor position in CSS pixels (for screen-space aim/picking). */
  cursorX = 0;
  cursorY = 0;

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
    this.pilotLook.attach(canvas);
    this.cursorX = window.innerWidth / 2;
    this.cursorY = window.innerHeight / 2;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    canvas.addEventListener('mousedown', this.handleMouseDown);
    canvas.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
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
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    this.canvas?.removeEventListener('wheel', this.handleWheel);
    this.releaseOrbit();
    this.keys.clear();
    this.mouseButtons.clear();
    this.pilotLook.detach();
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
    this.tetherQueued = false;
    this.printerQueued = false;
    this.cableQueued = false;
    this.toolQueued = false;
    this.brushQueued = false;
    this.primaryQueued = false;
    this.selectQueued = null;
    this.interactHeld = false;
    this.dragging = false;
    this.pilotLook.resetDeltas();
    this.releaseOrbit();
    if (enabled && this.pilotLook.isActive()) this.pilotLook.requestLock();
  }

  private requestPilotLock(): void {
    this.pilotLook.requestLock();
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

  /** True while Space is physically down (shuttle lift/launch, M14). */
  spaceHeld(): boolean {
    return this.keys.has('Space');
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

  /** True while E is held (1 s pack-up affordance). */
  isInteractHeld(): boolean {
    return this.interactHeld;
  }

  /** Edge-triggered: true once per C keydown (toggle the cable tool). */
  consumeCableToggle(): boolean {
    const cable = this.cableQueued;
    this.cableQueued = false;
    return cable;
  }

  /** Edge-triggered: true once per Q keydown (equip/stow the terrain tool). */
  consumeToolToggle(): boolean {
    const tool = this.toolQueued;
    this.toolQueued = false;
    return tool;
  }

  /** Edge-triggered: true once per X keydown (dig <-> add brush). */
  consumeBrushToggle(): boolean {
    const brush = this.brushQueued;
    this.brushQueued = false;
    return brush;
  }

  /** Edge-triggered: true once per left mouse down (grab/release click). */
  consumePrimaryClick(): boolean {
    const click = this.primaryQueued;
    this.primaryQueued = false;
    return click;
  }

  /** Edge-triggered: true once per T keydown (place a tether post). */
  consumeTether(): boolean {
    const tether = this.tetherQueued;
    this.tetherQueued = false;
    return tether;
  }

  /** Edge-triggered: true once per Tab keydown (backpack printer panel). */
  consumePrinter(): boolean {
    const printer = this.printerQueued;
    this.printerQueued = false;
    return printer;
  }

  /** Edge-triggered: slot index once per Digit1..8 keydown. */
  consumeSelect(): number | null {
    const select = this.selectQueued;
    this.selectQueued = null;
    return select;
  }

  /** True while the right (or middle) mouse button (camera orbit) is held. */
  isOrbiting(): boolean {
    return this.orbiting;
  }

  /**
   * Tool buttons: left = primary brush (dig or add, chosen by ToolMode),
   * F = flatten. Right mouse is camera-only and never reports here.
   */
  toolButtons(): { primary: boolean; flatten: boolean } {
    return {
      primary: this.mouseButtons.has(0),
      flatten: this.keys.has('KeyF'),
    };
  }

  private releaseOrbit(keepPilotLock = false): void {
    this.orbiting = false;
    this.dragging = false;
    if (!keepPilotLock && document.pointerLockElement === this.canvas) {
      try {
        document.exitPointerLock();
      } catch {
        // Pointer lock unavailable; nothing to release.
      }
    }
  }

  private handlePointerLockChange = (): void => {
    // Losing the lock (Esc, tab switch) must never leave the camera stuck in
    // orbit mode; the next middle-mouse press re-locks.
    if (document.pointerLockElement !== this.canvas) this.orbiting = false;
  };

  private handleBlur = (): void => {
    this.keys.clear();
    this.mouseButtons.clear();
    this.interactHeld = false;
    this.dragging = false;
    this.releaseOrbit();
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (isUiKey(e)) return;
    // Headlamp toggle works even when input is disabled (fly mode): the
    // lamp rides the camera, so it stays useful there.
    if (e.code === 'KeyL') {
      if (!e.repeat) this.headlampQueued = true;
      return;
    }
    if (!this.enabled) return;
    if (e.code.startsWith('F')) return;
    if (e.code === 'KeyE') {
      if (!e.repeat) {
        this.interactQueued = true;
        this.interactHeld = true;
      }
      return;
    }
    if (e.code === 'KeyC') {
      if (!e.repeat) this.cableQueued = true;
      return;
    }
    if (e.code === 'KeyQ') {
      if (!e.repeat) this.toolQueued = true;
      return;
    }
    if (e.code === 'KeyX') {
      if (!e.repeat) this.brushQueued = true;
      return;
    }
    if (e.code === 'KeyT') {
      if (!e.repeat) this.tetherQueued = true;
      return;
    }
    if (e.code === 'Tab') {
      // Tab must not move browser focus while playing.
      e.preventDefault();
      if (!e.repeat) this.printerQueued = true;
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
    if (e.code === 'KeyE') this.interactHeld = false;
    this.keys.delete(e.code);
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (!this.enabled) return;
    // Pilot mode owns the pointer. LMB is drained by the pilot input branch,
    // so it is a natural "re-lock after Esc/pause" gesture. RMB/MMB below
    // takes the existing orbit path (which also requests the lock).
    if (this.pilotLook.isActive() && e.button !== 1 && e.button !== 2 && document.pointerLockElement !== this.canvas) {
      this.requestPilotLock();
    }
    this.mouseButtons.add(e.button);
    if (e.button === 0) this.primaryQueued = true;
    if (e.button === 1 || e.button === 2) {
      // Right (or middle) mouse: camera orbit only. Lock the pointer for the
      // duration of the hold so the cursor is fixed while looking around.
      e.preventDefault();
      this.orbiting = true;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (document.pointerLockElement !== this.canvas) {
        try {
          const result = this.canvas?.requestPointerLock() as unknown as Promise<void> | undefined;
          result?.catch?.(() => {});
        } catch {
          // Pointer lock unavailable — drag fallback still works.
        }
      }
    }
  };

  private handleContextMenu = (e: MouseEvent): void => {
    // Right mouse is camera orbit, not a browser menu.
    e.preventDefault();
  };

  private handleMouseMove = (e: MouseEvent): void => {
    this.cursorX = e.clientX;
    this.cursorY = e.clientY;
    if (!this.enabled) return;
    if (this.pilotLook.isActive()) {
      if (this.orbiting) {
        // RMB while piloting is free-look: buffer camera-only movement and
        // leave the rig (ship steering) untouched.
        const delta = this.readLookDelta(e);
        if (delta) this.pilotLook.addLook(delta.dx, delta.dy);
      } else if (document.pointerLockElement === this.canvas) {
        // Pointer-locked pilot steering (no button needed).
        this.lookTarget?.addLook(e.movementX, e.movementY);
      }
      return;
    }
    if (!this.orbiting) return;
    const delta = this.readLookDelta(e);
    if (delta) this.lookTarget?.addLook(delta.dx, delta.dy);
  };

  /** Mouse delta from pointer lock, or the drag fallback while orbiting. */
  private readLookDelta(e: MouseEvent): { dx: number; dy: number } | null {
    if (document.pointerLockElement === this.canvas) {
      return { dx: e.movementX, dy: e.movementY };
    }
    if (this.dragging) {
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      return { dx, dy };
    }
    return null;
  }

  private handleMouseUp = (e: MouseEvent): void => {
    this.mouseButtons.delete(e.button);
    if (e.button === 1 || e.button === 2) this.releaseOrbit(this.pilotLook.isActive());
  };

  private handleWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    // Horizontal scroll (trackpads) reports deltaX with deltaY == 0: it must
    // not zoom, speed the fly camera or grow the brush.
    if (e.deltaY === 0) return;
    e.preventDefault();
    // Ctrl+wheel resizes the terrain brush instead of zooming the camera.
    if (e.ctrlKey) {
      this.radiusTarget?.adjustRadius(e.deltaY);
      return;
    }
    this.zoomTarget?.zoom(e.deltaY);
  };
}
