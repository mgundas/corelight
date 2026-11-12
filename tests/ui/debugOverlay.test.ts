// M13 debug overlay: the F1 payload names the dominant SOI planet, the
// signed distance to its boundary and the player's physics frame.

import { describe, expect, it } from 'vitest';
import { formatOverlayStats, type OverlayStats } from '../../src/ui/debugOverlay.js';

function stats(extra: Partial<OverlayStats> = {}): OverlayStats {
  return {
    fps: 60,
    tickMs: 1,
    cameraWorld: { x: 0, y: 0, z: 0 },
    origin: { x: 0, y: 0, z: 0 },
    drawCalls: 1,
    flySpeed: 60,
    originShifts: 0,
    ...extra,
  };
}

describe('debug overlay frame line', () => {
  it('shows dominant planet, signed SOI distance and physics frame', () => {
    const text = formatOverlayStats(
      stats({ dominantPlanet: 'Vorn', soiDistanceM: -652.4, physicsFrame: 'vorn' }),
    );
    expect(text).toContain('frame: dominant Vorn');
    expect(text).toContain('SOI -652 m (inside)');
    expect(text).toContain('physics vorn');
  });

  it('marks an outside position and deep space', () => {
    const text = formatOverlayStats(
      stats({ dominantPlanet: 'deep space', soiDistanceM: 480.2, physicsFrame: 'deep space' }),
    );
    expect(text).toContain('dominant deep space');
    expect(text).toContain('SOI +480 m (outside)');
    expect(text).toContain('physics deep space');
  });

  it('omits the frame line when no SOI data was supplied', () => {
    expect(formatOverlayStats(stats())).not.toContain('frame: dominant');
  });
});
