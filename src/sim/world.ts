import { SIM_DT } from '../core/constants.js';
import { events } from '../core/events.js';
import type { Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { TerrainEdits } from '../terrain/edits.js';
import { applyAction, type Action } from './actions.js';
import type { Entity, EntityId } from './entities.js';
import { SUN_INITIAL } from './systems/sun.js';

export type System = (world: World, dt: number) => void;

export interface WorldOptions {
  /** Static planet configs (not serialized; provided by the caller). */
  planets?: PlanetConfig[];
  /** Initial clock in seconds (restored saves pass their stored time). */
  time?: number;
  /** Restored entity-ID counter (keeps post-load IDs collision-free). */
  idCounter?: number;
}

export class World {
  entities = new Map<EntityId, Entity>();
  /** Seconds of simulated time. */
  time = 0;
  /** Shared sun direction (world space, unit length), re-derived from `time`
   * by the sun system every tick. Part of World state so saves and replays
   * agree on the light. */
  sunDirection: Vec3d = { ...SUN_INITIAL };
  seed: number;
  /** Sparse player terrain edits (sim state; serialized by M06 saves). */
  readonly terrainEdits = new TerrainEdits();
  /** Runtime planet configs (NOT serialized: static game data). */
  planets: PlanetConfig[] = [];
  private queue: Action[] = [];
  private systems: System[] = [];
  private idCounter = 0;

  constructor(seed = 1337, opts: WorldOptions = {}) {
    this.seed = seed;
    // Construction-time setup (planets/time/counter) goes through the
    // constructor so gameplay code never assigns World fields directly:
    // all later state changes flow through dispatch() + systems.
    if (opts.planets) this.planets = opts.planets;
    if (opts.time !== undefined) this.time = opts.time;
    if (opts.idCounter !== undefined) this.idCounter = opts.idCounter;
  }

  /** Deterministic entity ID: seed + per-world counter + call order. */
  nextId(prefix: string): EntityId {
    this.idCounter += 1;
    return `${prefix}_${this.seed.toString(36)}_${this.idCounter.toString(36)}`;
  }

  /** Counter value for saves (restored via the constructor). */
  getIdCounter(): number {
    return this.idCounter;
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
