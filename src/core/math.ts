// Vec3d / Quat math helpers. Plain objects with doubles (never three.js).
// WHY: sim and terrain must run on a future Node server, so they cannot
// depend on rendering types.

export interface Vec3d {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export function vec3(x = 0, y = 0, z = 0): Vec3d {
  return { x, y, z };
}

export function add(a: Vec3d, b: Vec3d): Vec3d {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3d, b: Vec3d): Vec3d {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(v: Vec3d, s: number): Vec3d {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function length(v: Vec3d): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function normalize(v: Vec3d): Vec3d {
  const len = length(v);
  if (len === 0) return vec3(0, 0, 0);
  return scale(v, 1 / len);
}

export function dot(a: Vec3d, b: Vec3d): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3d, b: Vec3d): Vec3d {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function distance(a: Vec3d, b: Vec3d): number {
  return length(sub(a, b));
}

export function lerp(a: Vec3d, b: Vec3d, t: number): Vec3d {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export const IDENTITY_QUAT: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function quatFromAxisAngle(axis: Vec3d, angleRad: number): Quat {
  const n = normalize(axis);
  const half = angleRad / 2;
  const s = Math.sin(half);
  return { x: n.x * s, y: n.y * s, z: n.z * s, w: Math.cos(half) };
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function rotateVector(v: Vec3d, q: Quat): Vec3d {
  // q * v * q^-1, treating v as a pure quaternion.
  const qv: Quat = { x: v.x, y: v.y, z: v.z, w: 0 };
  const conj: Quat = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  const tmp = quatMultiply(q, qv);
  const out = quatMultiply(tmp, conj);
  return { x: out.x, y: out.y, z: out.z };
}
