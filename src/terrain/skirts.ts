// LOD skirts: hide cracks between neighboring chunks meshed at different
// LOD levels. Where the surface meets a chunk boundary face, marching
// squares finds the intersection curve on that face and each segment is
// extruded along the inverse surface normal by one cellSize, forming a
// ribbon that overlaps whatever the neighbor built. Both windings are
// emitted so the ribbon is visible from either side with the shared
// single-sided material. Pure logic, no three.js (runs in mesh workers).

import { gradientAt, sampleIndex } from './density.js';
import { CELLS_PER_CHUNK, SAMPLE_GRID, type ColorFn } from './marchingCubes.js';

interface GridPos {
  x: number;
  y: number;
  z: number;
}

type Axis = 0 | 1 | 2;

interface FaceDef {
  fixed: Axis;
  sign: 1 | -1;
  u: Axis;
  v: Axis;
}

const FACES: ReadonlyArray<FaceDef> = [
  { fixed: 0, sign: -1, u: 1, v: 2 },
  { fixed: 0, sign: 1, u: 1, v: 2 },
  { fixed: 1, sign: -1, u: 0, v: 2 },
  { fixed: 1, sign: 1, u: 0, v: 2 },
  { fixed: 2, sign: -1, u: 0, v: 1 },
  { fixed: 2, sign: 1, u: 0, v: 1 },
];

/**
 * Marching-squares segments per case. Corners are (u,v), (u+1,v),
 * (u+1,v+1), (u,v+1); edges e0..e3 run bottom, right, top, left.
 * Saddle cases (5, 10) use a fixed pairing: skirts only need to cover
 * the boundary curve approximately, so either pairing hides the crack.
 */
const SEGMENTS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [],
  [[3, 0]],
  [[0, 1]],
  [[3, 1]],
  [[1, 2]],
  [
    [3, 0],
    [1, 2],
  ],
  [[0, 2]],
  [[3, 2]],
  [[2, 3]],
  [[0, 2]],
  [
    [0, 1],
    [2, 3],
  ],
  [[1, 2]],
  [[1, 3]],
  [[0, 1]],
  [[3, 0]],
  [],
];

/** Corner sample coords (1-based inside the 35^3 grid) for face cell (iu, iv). */
function cornerSample(face: FaceDef, iu: number, iv: number, corner: number): [number, number, number] {
  const su = 1 + iu + (corner === 1 || corner === 2 ? 1 : 0);
  const sv = 1 + iv + (corner >= 2 ? 1 : 0);
  const coords: [number, number, number] = [0, 0, 0];
  coords[face.fixed] = face.sign < 0 ? 1 : CELLS_PER_CHUNK + 1;
  coords[face.u] = su;
  coords[face.v] = sv;
  return coords;
}

/** Chunk-relative position of a face sample point. */
function cornerPos(face: FaceDef, iu: number, iv: number, corner: number, cellSize: number): GridPos {
  const pu = (iu + (corner === 1 || corner === 2 ? 1 : 0)) * cellSize;
  const pv = (iv + (corner >= 2 ? 1 : 0)) * cellSize;
  const pos: GridPos = { x: 0, y: 0, z: 0 };
  const fixed = face.sign < 0 ? 0 : CELLS_PER_CHUNK * cellSize;
  if (face.fixed === 0) pos.x = fixed;
  else if (face.fixed === 1) pos.y = fixed;
  else pos.z = fixed;
  if (face.u === 0) pos.x = pu;
  else if (face.u === 1) pos.y = pu;
  else pos.z = pu;
  if (face.v === 0) pos.x = pv;
  else if (face.v === 1) pos.y = pv;
  else pos.z = pv;
  return pos;
}

interface SurfacePoint {
  pos: GridPos;
  normal: GridPos;
  color: [number, number, number];
}

/**
 * Append boundary skirts to the mesh arrays. Positions stay chunk-relative
 * (like polygonize); colors are sampled at absolute planet-local coords.
 */
export function addSkirts(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  samples: Float32Array,
  origin: GridPos,
  cellSize: number,
  colorAt: ColorFn,
): void {
  const size = SAMPLE_GRID;
  const cells = CELLS_PER_CHUNK;
  for (const face of FACES) {
    for (let iv = 0; iv < cells; iv += 1) {
      for (let iu = 0; iu < cells; iu += 1) {
        const values: number[] = [];
        for (let c = 0; c < 4; c += 1) {
          const [sx, sy, sz] = cornerSample(face, iu, iv, c);
          values.push(samples[sampleIndex(sx, sy, sz, size)] as number);
        }
        let caseIndex = 0;
        for (let c = 0; c < 4; c += 1) {
          if ((values[c] as number) > 0) caseIndex |= 1 << c;
        }
        const segments = SEGMENTS[caseIndex] as ReadonlyArray<readonly [number, number]>;
        for (const [edgeA, edgeB] of segments) {
          const pa = edgePoint(face, iu, iv, edgeA, values, samples, origin, cellSize, colorAt);
          const pb = edgePoint(face, iu, iv, edgeB, values, samples, origin, cellSize, colorAt);
          if (!pa || !pb) continue;
          emitRibbon(positions, normals, colors, indices, pa, pb, cellSize);
        }
      }
    }
  }
}

const EDGE_CORNERS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
];

function edgePoint(
  face: FaceDef,
  iu: number,
  iv: number,
  edge: number,
  values: number[],
  samples: Float32Array,
  origin: GridPos,
  cellSize: number,
  colorAt: ColorFn,
): SurfacePoint | null {
  const [ca, cb] = EDGE_CORNERS[edge] as readonly [number, number];
  const va = values[ca] as number;
  const vb = values[cb] as number;
  if ((va > 0) === (vb > 0)) return null;
  const t = va / (va - vb);
  const posA = cornerPos(face, iu, iv, ca, cellSize);
  const posB = cornerPos(face, iu, iv, cb, cellSize);
  const pos: GridPos = {
    x: posA.x + (posB.x - posA.x) * t,
    y: posA.y + (posB.y - posA.y) * t,
    z: posA.z + (posB.z - posA.z) * t,
  };
  const [sax, say, saz] = cornerSample(face, iu, iv, ca);
  const [sbx, sby, sbz] = cornerSample(face, iu, iv, cb);
  const ga = gradientAt(samples, SAMPLE_GRID, sax, say, saz);
  const gb = gradientAt(samples, SAMPLE_GRID, sbx, sby, sbz);
  let nx = -(ga.x + (gb.x - ga.x) * t);
  let ny = -(ga.y + (gb.y - ga.y) * t);
  let nz = -(ga.z + (gb.z - ga.z) * t);
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len > 1e-9) {
    nx /= len;
    ny /= len;
    nz /= len;
  } else {
    nx = 0;
    ny = 1;
    nz = 0;
  }
  const rgb = colorAt(pos.x + origin.x, pos.y + origin.y, pos.z + origin.z, nx, ny, nz);
  return { pos, normal: { x: nx, y: ny, z: nz }, color: [rgb[0], rgb[1], rgb[2]] };
}

/** A quad from surface segment (a, b) hanging along the inverse normals. */
function emitRibbon(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  a: SurfacePoint,
  b: SurfacePoint,
  cellSize: number,
): void {
  const ax = a.pos.x - a.normal.x * cellSize;
  const ay = a.pos.y - a.normal.y * cellSize;
  const az = a.pos.z - a.normal.z * cellSize;
  const bx = b.pos.x - b.normal.x * cellSize;
  const by = b.pos.y - b.normal.y * cellSize;
  const bz = b.pos.z - b.normal.z * cellSize;
  const base = positions.length / 3;
  positions.push(a.pos.x, a.pos.y, a.pos.z, b.pos.x, b.pos.y, b.pos.z, bx, by, bz, ax, ay, az);
  normals.push(
    a.normal.x,
    a.normal.y,
    a.normal.z,
    b.normal.x,
    b.normal.y,
    b.normal.z,
    b.normal.x,
    b.normal.y,
    b.normal.z,
    a.normal.x,
    a.normal.y,
    a.normal.z,
  );
  colors.push(
    ...a.color,
    ...b.color,
    ...b.color,
    ...a.color,
  );
  // Both windings: the ribbon must read from whichever side the viewer
  // (and the coarser neighbor's displaced surface) ends up on.
  indices.push(
    base,
    base + 1,
    base + 2,
    base,
    base + 2,
    base + 3,
    base,
    base + 3,
    base + 2,
    base,
    base + 2,
    base + 1,
  );
}
