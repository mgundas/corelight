// View-frustum planes as plain data for the streaming priority queue.
// Built with three.js math here in render/; terrain/ only sees Vec3d.

import * as THREE from 'three';
import type { FrustumPlane } from '../terrain/chunkManager.js';

export function frustumPlanes(camera: THREE.PerspectiveCamera): FrustumPlane[] {
  camera.updateMatrixWorld();
  const combined = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const frustum = new THREE.Frustum().setFromProjectionMatrix(combined);
  return frustum.planes.map((plane) => ({
    normal: { x: plane.normal.x, y: plane.normal.y, z: plane.normal.z },
    constant: plane.constant,
  }));
}
