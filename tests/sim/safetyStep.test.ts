// Direct unit tests for the embedded safety net (no Rapier/workers needed:
// safetyStep only reads the density field). Covers gradient descent,
// flat-spot fallback, and the sticky surface-ward escape.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { createDensityField, type DensityField } from '../../src/terrain/density.js';
import { safetyStep } from '../../src/sim/physics/system.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import type { Entity } from '../../src/sim/entities.js';

function makeEntity(x: number, y: number, z: number): Entity {
  return {
    id: 'player_test',
    kind: 'player',
    planetId: 'sela',
    position: { x, y, z },
    rotation: { ...IDENTITY_QUAT },
    components: {
      player: {
        velocity: { x: 0, y: 0, z: 0 },
        grounded: false,
        yaw: 0,
        pitch: 0,
        input: null,
        embeddedTime: 0,
        escaping: false,
        soil: 0,
        toolHardness: 2,
        lastTooHard: -Infinity,
        headlampOn: true,
      },
    },
  };
}

function densityAt(fields: Map<string, DensityField>, entity: Entity): number {
  const field = fields.get(SELA.id);
  if (!field) throw new Error('no field');
  const p = entity.position;
  return field.density(p.x - SELA.center.x, p.y - SELA.center.y, p.z - SELA.center.z);
}

/** Run safety ticks; return the tick index when first freed (or -1). */
function runToFree(
  entity: Entity,
  fields: Map<string, DensityField>,
  maxTicks: number,
  onTick?: (tick: number, entity: Entity) => void,
): number {
  for (let i = 0; i < maxTicks; i += 1) {
    onTick?.(i, entity);
    if (densityAt(fields, entity) <= 0.5 && !entity.components.player?.escaping) {
      // Free and staying free: one more tick must return false.
      return i;
    }
    safetyStep(entity, fields, [SELA], 1 / 30);
  }
  return -1;
}

describe('safetyStep', () => {
  it('pushes out along the gradient from solid slab rock', () => {
    const fields = new Map([[SELA.id, createDensityField(SELA, 1337)]]);
    // Slab-0 rock with a healthy gradient (probed: d=3.05, |grad|=1.26).
    const entity = makeEntity(-76, SELA.radius - 72, -20);
    expect(densityAt(fields, entity)).toBeGreaterThan(0.5);
    const freedAt = runToFree(entity, fields, 200);
    expect(freedAt).toBeGreaterThanOrEqual(0);
    expect(densityAt(fields, entity)).toBeLessThanOrEqual(0.5);
  });

  it('walks out of a flat field minimum via the surface-ward fallback', () => {
    const fields = new Map([[SELA.id, createDensityField(SELA, 1337)]]);
    // Near-minimum bowl in slab 2 (probed: d=1.03, |grad|=0.025).
    const entity = makeEntity(-24, 220, 4);
    expect(densityAt(fields, entity)).toBeGreaterThan(0.5);
    const freedAt = runToFree(entity, fields, 300);
    expect(freedAt).toBeGreaterThanOrEqual(0);
  });

  it('latches sticky escape on a gradient-free plateau and plows out', () => {
    // Synthetic worst case: perfectly flat +1.0 rock for 40 m, air beyond.
    // Gradient descent can never engage; only the latched escape frees.
    const flat: DensityField = {
      config: SELA,
      density: (x, y, z) => (Math.hypot(x, y - 250, z) < 40 ? 1 : -1),
      caveThresholdAt: () => 0,
    };
    const fields = new Map([[SELA.id, flat]]);
    const entity = makeEntity(0, 250, 0);
    expect(densityAt(fields, entity)).toBeGreaterThan(0.5);
    let latched = false;
    const freedAt = runToFree(entity, fields, 400, (i, e) => {
      if (e.components.player?.escaping) latched = true;
      void i;
    });
    expect(latched).toBe(true);
    expect(freedAt).toBeGreaterThanOrEqual(0);
    expect(densityAt(fields, entity)).toBeLessThan(0);
    // Escape state stands down once free.
    expect(entity.components.player?.escaping).toBe(false);
  });
});
