// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { PlayerInput } from '../../src/player/input.js';
import { FreeFlyCamera } from '../../src/player/freeFlyCamera.js';

describe('overlay keyboard isolation', () => {
  it('leaves Space on a UI button available for native activation', () => {
    const canvas = document.createElement('canvas');
    const button = document.createElement('button');
    document.body.append(canvas, button);
    const input = new PlayerInput();
    input.attach(canvas, { addLook: () => undefined }, { zoom: () => undefined });
    const fly = new FreeFlyCamera();
    fly.attach(canvas);
    const event = new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(input.consumeJump()).toBe(false);
    input.detach(); fly.detach(); button.remove(); canvas.remove();
  });

  it('does not equip the tool or move the player while a settings input has focus', () => {
    const canvas = document.createElement('canvas');
    const slider = document.createElement('input');
    slider.type = 'range';
    document.body.append(canvas, slider);
    const input = new PlayerInput();
    input.attach(canvas, { addLook: () => undefined }, { zoom: () => undefined });
    slider.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', bubbles: true }));
    slider.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    expect(input.consumeToolToggle()).toBe(false);
    expect(input.move()).toEqual({ x: 0, z: 0 });
    input.detach(); slider.remove(); canvas.remove();
  });
});
