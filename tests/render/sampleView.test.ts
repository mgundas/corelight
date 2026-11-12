// M11 sample pod views: loose pods render, held pods hide, the glow joins
// the shared emitter list and the pulse animates from an injected clock.

import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import type { Entity } from '../../src/sim/entities.js';
import { SampleViews } from '../../src/render/views/sampleView.js';

function sample(holder?: string): Entity {
  return {
    id: 'sample_sela_0_16_23_16',
    kind: 'sample',
    planetId: 'sela',
    position: { x: 10, y: 380, z: 4 },
    rotation: { ...IDENTITY_QUAT },
    components: {
      sample: { value: 20, chunkKey: 'sela:0:16:23:16' },
      item: holder ? { itemId: 'research_sample', holder } : { itemId: 'research_sample' },
    },
  };
}

describe('SampleViews', () => {
  it('adds, pulses, glows and removes pods', () => {
    const views = new SampleViews();
    const loose = sample();
    expect(views.sync([loose], 0)).toHaveLength(1);
    const pod = views.group.children[0];
    const scaleA = pod?.scale.x ?? 0;
    views.sync([loose], 500);
    const scaleB = views.group.children[0]?.scale.x ?? 0;
    expect(scaleA).not.toBe(scaleB);
    const emitters = views.sync([], 1000);
    expect(emitters).toHaveLength(0);
    expect(views.group.children).toHaveLength(0);
    views.dispose();
  });

  it('hides carried/station-held pods', () => {
    const views = new SampleViews();
    views.sync([sample('player_1')], 0);
    expect(views.group.children).toHaveLength(0);
    views.dispose();
  });
});
