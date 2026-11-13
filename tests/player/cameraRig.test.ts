import { beforeEach, describe, expect, it } from 'vitest';
import { CameraRig, CAM_DISTANCE_MAX, CAM_DISTANCE_MIN } from '../../src/player/cameraRig.js';
import { DEFAULT_SETTINGS, updateSettings } from '../../src/core/settings.js';
import { distance, normalize } from '../../src/core/math.js';

beforeEach(() => { updateSettings(DEFAULT_SETTINGS); });

describe('CameraRig', () => {
  it('does not force the on-foot camera beyond a nearby terrain hit after exit', () => {
    const rig = new CameraRig();
    const position = { x: 0, y: 400, z: 0 };
    rig.update(position, { x: 0, y: 1, z: 0 }, () => 0.2, 1 / 60);
    expect(distance(rig.position, { x: 0, y: 401.5, z: 0 })).toBeLessThan(0.2);
  });
  it('does not whip around when walking across the old movement-frame latitude boundary', () => {
    const rig = new CameraRig();
    rig.distance = 8;
    const y = 391.1;
    const z = 17.9;
    const x = Math.sqrt(y * y * (1 / 0.99 ** 2 - 1) - z * z);
    const before = { x: x - 0.01, y, z };
    const after = { x: x + 0.01, y, z };
    rig.update(before, normalize(before), () => null, 1 / 60);
    const cameraBefore = { ...rig.position };
    rig.update(after, normalize(after), () => null, 1 / 60);
    expect(distance(cameraBefore, rig.position)).toBeLessThan(0.1);
  });

  it('clamps zoom to [2, 8]', () => {
    const rig = new CameraRig();
    for (let i = 0; i < 20; i += 1) rig.zoom(-100);
    expect(rig.distance).toBe(CAM_DISTANCE_MIN);
    for (let i = 0; i < 20; i += 1) rig.zoom(100);
    expect(rig.distance).toBe(CAM_DISTANCE_MAX);
  });

  it('ignores horizontal wheel (deltaY 0)', () => {
    const rig = new CameraRig();
    const before = rig.distance;
    rig.zoom(0);
    expect(rig.distance).toBe(before);
  });

  it('sits 4 m behind the head when clear', () => {
    const rig = new CameraRig();
    rig.yaw = 0;
    rig.pitch = 0;
    rig.update({ x: 0, y: 400, z: 0 }, { x: 0, y: 1, z: 0 }, () => null);
    // Head at y = 401.5, facing +X (moveBasis yaw 0 = north): camera at -X.
    expect(rig.position.x).toBeCloseTo(-4, 6);
    expect(rig.position.y).toBeCloseTo(401.5, 6);
    expect(rig.position.z).toBeCloseTo(0, 6);
  });

  it('pulls in when a wall is behind', () => {
    const rig = new CameraRig();
    rig.yaw = 0;
    rig.pitch = 0;
    rig.update({ x: 0, y: 400, z: 0 }, { x: 0, y: 1, z: 0 }, () => 2);
    // Hit at 2 m -> camera at 2 - 0.3 margin from the head.
    expect(rig.position.x).toBeCloseTo(-1.7, 6);
  });

  it('clamps look pitch', () => {
    const rig = new CameraRig();
    rig.addLook(0, -100000);
    expect(rig.pitch).toBeLessThan(Math.PI / 2);
    rig.addLook(0, 100000);
    expect(rig.pitch).toBeGreaterThan(-Math.PI / 2);
  });

  it('applies sensitivity and vertical inversion to look input', () => {
    const normal = new CameraRig();
    const inverted = new CameraRig();
    normal.pitch = 0;
    normal.addLook(10, 10);
    updateSettings({ sensitivity: 2, invertY: true });
    inverted.pitch = 0;
    inverted.addLook(10, 10);
    expect(inverted.yaw).toBeCloseTo(normal.yaw * 2);
    expect(inverted.pitch).toBeCloseTo(-normal.pitch * 2);
  });

  it('avoids walls immediately and recovers without a sudden distance jump', () => {
    const rig = new CameraRig();
    rig.pitch = 0;
    const pos = { x: 0, y: 400, z: 0 };
    const up = { x: 0, y: 1, z: 0 };
    rig.update(pos, up, () => null, 1 / 60);
    rig.update(pos, up, () => 2, 1 / 60);
    expect(rig.position.x).toBeCloseTo(-1.7);
    rig.update(pos, up, () => null, 1 / 60);
    expect(rig.position.x).toBeLessThan(-1.7);
    expect(rig.position.x).toBeGreaterThan(-4);
    updateSettings({ smoothCamera: false });
    rig.update(pos, up, () => null, 1 / 60);
    expect(rig.position.x).toBeCloseTo(-4);
  });

  it('has the same recovery speed at 30 and 60 rendering FPS', () => {
    function recover(fps: number): number {
      const rig = new CameraRig();
      rig.pitch = 0;
      const pos = { x: 0, y: 400, z: 0 };
      const up = { x: 0, y: 1, z: 0 };
      rig.update(pos, up, () => 2, 1 / fps);
      for (let i = 0; i < fps; i += 1) rig.update(pos, up, () => null, 1 / fps);
      return rig.position.x;
    }
    expect(recover(30)).toBeCloseTo(recover(60), 8);
  });
});
