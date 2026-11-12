import * as THREE from 'three';
import { AVATAR_LIMB_SWING } from '../../core/constants.js';

/** Art-only rig: pivots animate from travelled distance, never drive physics. */
export function makeAstronaut() {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0xdce8df, roughness: 0.75, flatShading: true });
  const trim = new THREE.MeshStandardMaterial({ color: 0x294752, roughness: 0.7, flatShading: true });
  const accent = new THREE.MeshStandardMaterial({ color: 0xe7a664, roughness: 0.7, flatShading: true });
  const visor = new THREE.MeshStandardMaterial({ color: 0x102d3b, roughness: 0.23, metalness: 0.45 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xbdf5df, emissive: 0x7fcbb5, emissiveIntensity: 0.6 });
  const materials = [suit, trim, accent, visor, lamp];
  function part(parent: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  part(group, new THREE.CapsuleGeometry(0.29, 0.2, 3, 8), suit, 0, 0.12, 0);
  part(group, new THREE.BoxGeometry(0.43, 0.14, 0.4), trim, 0, -0.22, 0);
  part(group, new THREE.BoxGeometry(0.29, 0.23, 0.08), accent, 0, 0.17, 0.27);
  part(group, new THREE.BoxGeometry(0.13, 0.035, 0.02), lamp, 0, 0.22, 0.32);
  part(group, new THREE.SphereGeometry(0.32, 16, 12), suit, 0, 0.62, 0.015);
  const glass = part(group, new THREE.SphereGeometry(0.273, 16, 12), visor, 0, 0.64, 0.21);
  glass.scale.set(1, 0.72, 0.72);
  part(group, new THREE.BoxGeometry(0.13, 0.07, 0.09), lamp, 0, 0.84, 0.22);
  part(group, new THREE.BoxGeometry(0.42, 0.5, 0.23), trim, 0, 0.08, -0.32);
  for (const x of [-0.16, 0.16]) {
    part(group, new THREE.CylinderGeometry(0.065, 0.065, 0.42, 8), accent, x, 0.1, -0.47);
  }
  const legs: THREE.Group[] = [];
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.16, -0.23, 0);
    part(leg, new THREE.CapsuleGeometry(0.12, 0.26, 3, 8), suit, 0, -0.23, 0);
    part(leg, new THREE.BoxGeometry(0.23, 0.2, 0.34), trim, 0, -0.54, 0.05);
    group.add(leg);
    legs.push(leg);
    const arm = new THREE.Group();
    arm.position.set(side * 0.35, 0.31, 0);
    part(arm, new THREE.SphereGeometry(0.15, 8, 6), accent, 0, 0, 0);
    part(arm, new THREE.CapsuleGeometry(0.09, 0.27, 3, 8), suit, side * 0.025, -0.22, 0);
    part(arm, new THREE.SphereGeometry(0.1, 8, 6), trim, side * 0.025, -0.43, 0);
    group.add(arm);
    arms.push(arm);
  }
  return {
    group,
    animate(phase: number, moving: boolean): void {
      const swing = moving ? Math.sin(phase) * AVATAR_LIMB_SWING : 0;
      for (let i = 0; i < legs.length; i += 1) {
        const sign = i === 0 ? 1 : -1;
        legs[i]!.rotation.x = swing * sign;
        arms[i]!.rotation.x = -swing * sign;
      }
    },
    dispose(): void {
      group.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
      for (const material of materials) material.dispose();
      group.clear();
    },
  };
}
