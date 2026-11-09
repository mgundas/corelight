import { SIM_DT } from '../core/constants.js';
import { events } from '../core/events.js';
import { applyAction, type Action } from './actions.js';
import type { Entity, EntityId } from './entities.js';

export type System = (world: World, dt: number) => void;

export class World {
  entities = new Map<EntityId, Entity>();
  /** Seconds of simulated time. */
  time = 0;
  seed: number;
  private queue: Action[] = [];
  private systems: System[] = [];

  constructor(seed = 1337) {
    this.seed = seed;
  }

  addSystem(system: System): void {
    this.systems.push(system);
  }

  dispatch(action: Action): void {
    this.queue.push(action);
  }

  tick(dt: number = SIM_DT): void {
    const pending = this.queue;
    this.queue = [];
    for (const action of pending) {
      applyAction(this, action);
    }
    for (const system of this.systems) {
      system(this, dt);
    }
    this.time += dt;
    events.emit('tick', { time: this.time });
  }
}
