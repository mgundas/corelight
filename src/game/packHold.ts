// Hold-E pack-up timer (M10). Pure input state: a press starts the timer,
// holding for PACK_HOLD_MS reports 'pack', and releasing early reports
// 'release' so the caller can run the normal tap-E action instead. The sim
// action re-validates emptiness/range; this only times the gesture.

import { PACK_HOLD_MS } from '../core/constants.js';
import type { EntityId } from '../sim/entities.js';

export type PackHoldResult = 'idle' | 'hold' | 'pack' | 'release';

export class PackHold {
  private target: EntityId | null = null;
  private startedMs = 0;

  press(targetId: EntityId, nowMs: number): void {
    this.target = targetId;
    this.startedMs = nowMs;
  }

  reset(): void {
    this.target = null;
  }

  /** Call every tick while a packable target is aimed. */
  update(held: boolean, nowMs: number, targetId: EntityId | null): PackHoldResult {
    if (!this.target) return 'idle';
    if (targetId !== this.target) {
      this.reset();
      return 'idle';
    }
    if (!held) {
      this.reset();
      return 'release';
    }
    if (nowMs - this.startedMs >= PACK_HOLD_MS) {
      this.reset();
      return 'pack';
    }
    return 'hold';
  }
}
