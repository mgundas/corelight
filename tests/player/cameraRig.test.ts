import { describe, expect, it } from 'vitest';
import { CameraRig, CAM_DISTANCE_MAX, CAM_DISTANCE_MIN } from '../../src/player/cameraRig.js';

describe('CameraRig', () => {
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
});
