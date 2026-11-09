import * as THREE from 'three';
import type { Vec3d } from '../core/math.js';

// Free-fly debug camera (F3). WASD + mouse (pointer lock), Q/E down/up,
// scroll changes speed 1..2000 m/s. On by default in M00.

export class FreeFlyCamera {
  position: Vec3d = { x: 0, y: 80, z: 620 };
  yaw = 0;
  pitch = 0;
  speed = 60;
  enabled = true;

  private keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private canvas: HTMLCanvasElement | null = null;
  private onSpeedChange: ((speed: number) => void) | null = null;

  attach(canvas: HTMLCanvasElement, onSpeedChange?: (speed: number) => void): void {
    this.canvas = canvas;
    this.onSpeedChange = onSpeedChange ?? null;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    canvas.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  detach(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.canvas?.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas?.removeEventListener('wheel', this.handleWheel);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'F3') return; // handled by Game toggle
    this.keys.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (!this.enabled) return;
    // Pointer lock gives smooth look; fall back to drag if unavailable.
    if (document.pointerLockElement !== this.canvas) {
      this.canvas?.requestPointerLock();
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
    this.yaw -= dx * 0.0025;
    this.pitch -= dy * 0.0025;
    const limit = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  };

  private handleMouseUp = (): void => {
    this.dragging = false;
  };

  private handleWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.85 : 1.18;
    this.speed = Math.max(1, Math.min(2000, this.speed * factor));
    this.onSpeedChange?.(this.speed);
  };

  forward(): Vec3d {
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    return { x: -sy * cp, y: sp, z: -cy * cp };
  }

  right(): Vec3d {
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    return { x: cy, y: 0, z: -sy };
  }

  update(dtSeconds: number): void {
    if (!this.enabled) return;
    const fwd = this.forward();
    const right = this.right();
    let mx = 0;
    let my = 0;
    let mz = 0;
    if (this.keys.has('KeyW')) mz += 1;
    if (this.keys.has('KeyS')) mz -= 1;
    if (this.keys.has('KeyD')) mx += 1;
    if (this.keys.has('KeyA')) mx -= 1;
    if (this.keys.has('KeyE') || this.keys.has('Space')) my += 1;
    if (this.keys.has('KeyQ')) my -= 1;
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4 : 1;
    const step = this.speed * boost * dtSeconds;
    this.position = {
      x: this.position.x + (fwd.x * mz + right.x * mx) * step,
      y: this.position.y + (fwd.y * mz + my) * step,
      z: this.position.z + (fwd.z * mz + right.z * mx) * step,
    };
  }

  applyToCamera(camera: THREE.PerspectiveCamera, local: Vec3d): void {
    camera.position.set(local.x, local.y, local.z);
    const fwd = this.forward();
    camera.lookAt(local.x + fwd.x, local.y + fwd.y, local.z + fwd.z);
    camera.up.set(0, 1, 0);
  }
}
