import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/constants.js';
import { World } from '../../src/sim/world.js';

describe('World dispatch + tick', () => {
  it('applies a dispatched action on tick', () => {
    const world = new World(42);
    expect(world.entities.size).toBe(0);
    world.dispatch({ type: 'debugSpawnMarker', position: { x: 1, y: 2, z: 3 } });
    // Queued, not yet applied.
    expect(world.entities.size).toBe(0);
    world.tick(SIM_DT);
    expect(world.entities.size).toBe(1);
    const entity = [...world.entities.values()][0];
    expect(entity).toBeDefined();
    expect(entity?.kind).toBe('marker');
    expect(entity?.position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('runs systems in registration order after actions', () => {
    const world = new World(7);
    const order: string[] = [];
    world.addSystem(() => {
      order.push('first');
    });
    world.addSystem(() => {
      order.push('second');
    });
    world.dispatch({ type: 'noop' });
    world.tick(SIM_DT);
    expect(order).toEqual(['first', 'second']);
    // Actions ran (noop is a no-op) and time advanced.
    expect(world.time).toBeCloseTo(SIM_DT);
  });

  it('advances time by dt each tick', () => {
    const world = new World(7);
    world.tick();
    world.tick();
    expect(world.time).toBeCloseTo(2 * SIM_DT);
  });
});
