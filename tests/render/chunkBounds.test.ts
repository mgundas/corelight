// ChunkBounds tests: signature gating avoids rebuilds, dispose releases
// helper geometry/materials (Renderer.dispose calls it on quit).

import { describe, expect, it } from 'vitest';
import { ChunkBounds } from '../../src/render/chunkBounds.js';

describe('ChunkBounds', () => {
  it('rebuilds on set change and releases everything on dispose', () => {
    const bounds = new ChunkBounds();
    bounds.setVisible(true);
    const boxes = [
      { key: 'sela:0:1:2:3', level: 0, min: { x: 0, y: 0, z: 0 }, size: 32 },
      { key: 'sela:1:0:0:0', level: 1, min: { x: -512, y: -512, z: -512 }, size: 64 },
    ];
    bounds.update(boxes);
    expect(bounds.group.children.length).toBe(2);
    // Same set: no rebuild.
    bounds.update([...boxes].reverse());
    expect(bounds.group.children.length).toBe(2);
    bounds.dispose();
    expect(bounds.group.children.length).toBe(0);
  });
});
