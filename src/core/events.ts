// Tiny typed event bus. Sim emits events; UI/audio/render subscribe.
// WHY: keeps sim decoupled from presentation (hard rule 2 support).

export type EventMap = {
  originShifted: { origin: { x: number; y: number; z: number } };
  actionApplied: { type: string };
  tick: { time: number };
};

export type EventName = keyof EventMap;

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler<unknown>>>();

  on<K extends EventName>(name: K, fn: Handler<EventMap[K]>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    const wrapped = fn as Handler<unknown>;
    set.add(wrapped);
    return () => {
      set?.delete(wrapped);
    };
  }

  emit<K extends EventName>(name: K, payload: EventMap[K]): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of set) {
      (fn as Handler<EventMap[K]>)(payload);
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const events = new EventBus();
