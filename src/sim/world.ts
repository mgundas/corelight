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
  private idCounter = 0;

  constructor(seed = 1337) {
    this.seed = seed;
  }

  /** Deterministic entity ID: seed + per-world counter + call order. */
  nextId(prefix: string): EntityId {
    this.idCounter += 1;
    return `${prefix}_${this.seed.toString(36)}_${this.idCounter.toString(36)}`;
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
