// ChunkMeshes tests: add/remove/empty caching, world boxes, and LRU
// eviction. Headless (no WebGL needed for BufferGeometry bookkeeping).

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import type { MeshSink } from '../../src/terrain/chunkManager.js';
import { nodeKey, nodeOrigin } from '../../src/terrain/octree.js';
import type { MeshResult } from '../../src/terrain/workerPool.js';
import { resetOrigin } from '../../src/render/floatingOrigin.js';
import { ChunkMeshes } from '../../src/render/chunkMeshes.js';

function result(level: number, coord: { x: number; y: number; z: number }, empty: boolean): MeshResult {
  const origin = nodeOrigin(SELA, level, coord);
  return {
    id: 0,
    key: nodeKey(SELA.id, level, coord),
    origin: { ...origin },
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    colors: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]),
    indices: new Uint32Array([0, 1, 2]),
    empty,
  };
}

describe('ChunkMeshes', () => {
  it('satisfies the streamer MeshSink contract', () => {
    resetOrigin();
    const meshes = new ChunkMeshes();
    const sink: MeshSink = meshes;
    expect(sink.has('sela:0:1:2:3')).toBe(false);
    expect(sink.add(SELA, result(0, { x: 1, y: 2, z: 3 }, false))).toBe('added');
    expect(sink.has('sela:0:1:2:3')).toBe(true);
    expect(sink.add(SELA, result(0, { x: 1, y: 2, z: 3 }, false))).toBe('duplicate');
    expect(sink.add(SELA, result(0, { x: 4, y: 5, z: 6 }, true))).toBe('empty');
    expect(sink.has('sela:0:4:5:6')).toBe(true);
    expect(sink.emptyCount).toBe(1);
    const boxes = sink.boxes();
    expect(boxes.length).toBe(1);
    expect(boxes[0]?.level).toBe(0);
    expect(sink.remove('sela:0:1:2:3')).toBe(true);
    expect(sink.has('sela:0:1:2:3')).toBe(false);
    expect(sink.remove('sela:0:1:2:3')).toBe(false);
    meshes.dispose();
  });

  it('evicts the oldest meshes past the cache budget', () => {
    resetOrigin();
    const meshes = new ChunkMeshes();
    const total = 1500 + 5;
    for (let i = 0; i < total; i += 1) {
      meshes.add(SELA, result(0, { x: i, y: 0, z: 0 }, false));
    }
    expect(meshes.count).toBe(1500);
    // Insertion order: the earliest keys were evicted.
    expect(meshes.has('sela:0:0:0:0')).toBe(false);
    expect(meshes.has(`sela:0:${total - 1}:0:0`)).toBe(true);
    meshes.dispose();
  });
});
