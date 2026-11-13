// @vitest-environment jsdom
// Pointer/keyboard mapping: the cursor is free until RMB-hold, which orbits
// the camera and requests pointer lock only for the hold. LMB is the tool /
// grab button; RMB never reports as a tool button. Q/X queue tool toggles.

import { describe, expect, it } from 'vitest';
import { PlayerInput } from '../../src/player/input.js';

interface TestCanvas extends HTMLCanvasElement {
  requestPointerLock: () => Promise<void>;
}

function setup(): {
  input: PlayerInput;
  canvas: TestCanvas;
  look: { dx: number; dy: number };
  lockRequests: { count: number };
} {
  const canvas = document.createElement('canvas') as TestCanvas;
  document.body.appendChild(canvas);
  const lockRequests = { count: 0 };
  canvas.requestPointerLock = () => {
    lockRequests.count += 1;
    return Promise.resolve();
  };
  const look = { dx: 0, dy: 0 };
  const input = new PlayerInput();
  input.attach(
    canvas,
    { addLook: (dx, dy) => { look.dx += dx; look.dy += dy; } },
    { zoom: () => undefined },
    { adjustRadius: () => undefined },
  );
  return { input, canvas, look, lockRequests };
}

function mouseDown(canvas: HTMLCanvasElement, button: number, x = 100, y = 100): void {
  canvas.dispatchEvent(new MouseEvent('mousedown', { button, clientX: x, clientY: y, bubbles: true }));
}

function mouseMove(x: number, y: number): void {
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }));
}

function mouseUp(button: number): void {
  window.dispatchEvent(new MouseEvent('mouseup', { button }));
}

describe('PlayerInput pointer model', () => {
  it('keeps pilot pointer lock after releasing RMB, so steering resumes immediately', () => {
    const { input, canvas, look } = setup();
    const oldLock = Object.getOwnPropertyDescriptor(document, 'pointerLockElement');
    const oldExit = Object.getOwnPropertyDescriptor(document, 'exitPointerLock');
    let locked: Element | null = canvas;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
    Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: () => { locked = null; } });
    try {
      input.pilotLook.setActive(true);
      mouseDown(canvas, 2);
      mouseUp(2);
      expect(locked).toBe(canvas);
      const event = new MouseEvent('mousemove');
      Object.defineProperties(event, { movementX: { value: 7 }, movementY: { value: 3 } });
      window.dispatchEvent(event);
      expect(look).toEqual({ dx: 7, dy: 3 });
    } finally {
      input.detach();
      if (oldLock) Object.defineProperty(document, 'pointerLockElement', oldLock); else Reflect.deleteProperty(document, 'pointerLockElement');
      if (oldExit) Object.defineProperty(document, 'exitPointerLock', oldExit); else Reflect.deleteProperty(document, 'exitPointerLock');
    }
  });
  it('orbits with right mouse only while held and locks the pointer', () => {
    const { input, canvas, look, lockRequests } = setup();
    mouseDown(canvas, 2);
    expect(input.isOrbiting()).toBe(true);
    expect(lockRequests.count).toBe(1);
    mouseMove(110, 105);
    expect(look).toEqual({ dx: 10, dy: 5 });
    mouseUp(2);
    expect(input.isOrbiting()).toBe(false);
    // Movement after release must not rotate the camera.
    mouseMove(200, 200);
    expect(look).toEqual({ dx: 10, dy: 5 });
  });

  it('never reports RMB as a tool button and does not lock on LMB', () => {
    const { input, canvas, lockRequests } = setup();
    mouseDown(canvas, 2);
    expect(input.toolButtons().primary).toBe(false);
    mouseUp(2);
    mouseDown(canvas, 0);
    expect(lockRequests.count).toBe(1);
    expect(input.toolButtons().primary).toBe(true);
    expect(input.consumePrimaryClick()).toBe(true);
    mouseUp(0);
    expect(input.toolButtons().primary).toBe(false);
  });

  it('queues Q tool toggle and X brush toggle once per keydown', () => {
    const { input } = setup();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', repeat: true }));
    expect(input.consumeToolToggle()).toBe(true);
    expect(input.consumeToolToggle()).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX' }));
    expect(input.consumeBrushToggle()).toBe(true);
    expect(input.consumeBrushToggle()).toBe(false);
  });

  it('separates pilot steering from RMB free-look', () => {
    const { input, canvas, look, lockRequests } = setup();
    input.pilotLook.setActive(true);
    expect(input.pilotLook.isActive()).toBe(true);
    expect(lockRequests.count).toBeGreaterThan(0);
    // RMB while piloting buffers camera-only movement; the steering rig
    // (look) must not move, so the ship keeps its heading.
    mouseDown(canvas, 2);
    mouseMove(110, 105);
    expect(input.pilotLook.consume()).toEqual({ dx: 10, dy: 5 });
    expect(look).toEqual({ dx: 0, dy: 0 });
    mouseUp(2);
    // Released: no stale free-look delta is left for the camera.
    expect(input.pilotLook.consume()).toEqual({ dx: 0, dy: 0 });
    input.pilotLook.setActive(false);
    expect(input.pilotLook.isActive()).toBe(false);
  });

  it('clears orbit and input queues when disabled', () => {
    const { input, canvas } = setup();
    mouseDown(canvas, 2);
    input.setEnabled(false);
    expect(input.isOrbiting()).toBe(false);
    expect(input.toolButtons().primary).toBe(false);
  });
});
