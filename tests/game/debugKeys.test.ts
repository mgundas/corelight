// M13 debug hotkey gating: V is only swallowed when the dev teleport
// actually fires (a non-dev game keeps the key free), and plain debug keys
// still map to their actions.

import { describe, expect, it } from 'vitest';
import { handleDebugKey, type DebugKeyDeps } from '../../src/game/debugKeys.js';
import type { DebugOverlay } from '../../src/ui/debugOverlay.js';

interface FakeEvent {
  code: string;
  prevented: boolean;
  preventDefault(): void;
}

function keyEvent(code: string): FakeEvent {
  const event: FakeEvent = {
    code,
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
  };
  return event;
}

function makeDeps(overrides: Partial<DebugKeyDeps> = {}): { deps: DebugKeyDeps; calls: string[] } {
  const calls: string[] = [];
  const deps: DebugKeyDeps = {
    overlay: { toggle: () => calls.push('overlay') } as unknown as DebugOverlay,
    toggleFly: () => calls.push('fly'),
    toggleWireframe: () => calls.push('wireframe'),
    toggleBounds: () => calls.push('bounds'),
    devTeleportToVorn: () => {
      calls.push('vorn');
      return false;
    },
    ...overrides,
  };
  return { deps, calls };
}

describe('handleDebugKey', () => {
  it('routes the existing debug keys', () => {
    const { deps, calls } = makeDeps();
    for (const code of ['F1', 'F3', 'F4', 'KeyB']) {
      const event = keyEvent(code);
      handleDebugKey(event, deps);
      expect(event.prevented).toBe(true);
    }
    expect(calls).toEqual(['overlay', 'fly', 'wireframe', 'bounds']);
  });

  it('leaves V to the browser when no dev teleport fires', () => {
    const { deps } = makeDeps();
    const event = keyEvent('KeyV');
    handleDebugKey(event, deps);
    expect(event.prevented).toBe(false);
  });

  it('consumes V when the dev teleport is live', () => {
    const { deps } = makeDeps({ devTeleportToVorn: () => true });
    const event = keyEvent('KeyV');
    handleDebugKey(event, deps);
    expect(event.prevented).toBe(true);
  });

  it('never intercepts F5 (browser refresh)', () => {
    const { deps, calls } = makeDeps();
    const event = keyEvent('F5');
    handleDebugKey(event, deps);
    expect(event.prevented).toBe(false);
    expect(calls).toEqual([]);
  });
});
