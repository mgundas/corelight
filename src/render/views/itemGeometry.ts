// Shared low-poly item meshes (M07): one geometry per shape, one material
// per color, all cached. itemView (ground), nodeView (deposits) and
// playerView (backpack) build meshes from here so every Resin looks the
// same everywhere. Callers never dispose shared handles; Renderer calls
// disposeItemCaches() once on teardown.

import * as THREE from 'three';
import type { ItemDef } from '../../data/loadData.js';

const geometries = new Map<string, THREE.BufferGeometry>();
const materials = new Map<string, THREE.MeshStandardMaterial>();

/** Scale by catalog size (v1 is mostly small; medium uniques read bigger). */
export function sizeScale(def: ItemDef): number {
  if (def.size === 'large') return 1.8;
  if (def.size === 'medium') return 1.35;
  return 1;
}

export function geometryFor(shape: ItemDef['shape']): THREE.BufferGeometry {
  const cached = geometries.get(shape);
  if (cached) return cached;
  let geo: THREE.BufferGeometry;
  if (shape === 'cube') geo = new THREE.BoxGeometry(0.36, 0.36, 0.36);
  else if (shape === 'sphere') geo = new THREE.SphereGeometry(0.22, 8, 6);
  else if (shape === 'crystal') {
    geo = new THREE.OctahedronGeometry(0.3);
    geo.scale(1, 1.6, 1);
  } else if (shape === 'capsule') geo = new THREE.CapsuleGeometry(0.16, 0.26, 4, 8);
  else if (shape === 'crate') {
    // Packaged placeables: a boxy crate with a visible lid ridge.
    geo = new THREE.BoxGeometry(0.62, 0.55, 0.62);
  } else geo = new THREE.CylinderGeometry(0.18, 0.18, 0.46, 10);
  geometries.set(shape, geo);
  return geo;
}

export function materialFor(color: string): THREE.MeshStandardMaterial {
  const cached = materials.get(color);
  if (cached) return cached;
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.7,
    metalness: 0.1,
    flatShading: true,
  });
  materials.set(color, mat);
  return mat;
}

/** A fresh Mesh sharing the cached geometry/material (caller owns it). */
export function makeItemMesh(def: ItemDef): THREE.Mesh {
  const mesh = new THREE.Mesh(geometryFor(def.shape), materialFor(def.color));
  mesh.scale.setScalar(sizeScale(def));
  return mesh;
}

export function disposeItemCaches(): void {
  for (const geo of geometries.values()) geo.dispose();
  for (const mat of materials.values()) mat.dispose();
  geometries.clear();
  materials.clear();
}
