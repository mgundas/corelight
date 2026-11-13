// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { DEV_ITEM_MAX_COUNT } from '../../src/core/constants.js';
import { ITEMS } from '../../src/data/loadData.js';
import { installUiCommands } from '../../src/game/uiCommands.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { World } from '../../src/sim/world.js';
import { DevItemsPanel } from '../../src/ui/react/DevItemsPanel.js';
import { resetUiCommands, uiCommands } from '../../src/ui/stores/commandsStore.js';
import { isDevItemsOpen } from '../../src/ui/stores/devItemsStore.js';
import { useMenuStore } from '../../src/ui/stores/menuStore.js';

beforeEach(() => {
  window.history.replaceState({}, '', '/?dev=1');
  useMenuStore.setState({ view: { kind: 'none' } });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true, value(this: HTMLDialogElement) { this.open = true; },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true, value(this: HTMLDialogElement) { this.open = false; },
  });
});
afterEach(() => { resetUiCommands(); window.history.replaceState({}, '', '/'); });

function setup() {
  const world = new World(1337, { planets: [SELA] });
  world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: { x: 0, y: 402, z: 0 } });
  world.tick();
  const player = [...world.entities.values()][0]!;
  const change = vi.fn();
  const closePrinter = vi.fn();
  installUiCommands(world, () => player.id, closePrinter, () => undefined, change);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(<DevItemsPanel />));
  return { world, player, host, change, closePrinter,
    open: () => flushSync(() => host.querySelector<HTMLButtonElement>('#dev-items-toggle')!.click()),
    dispose: () => { flushSync(() => root.unmount()); host.remove(); },
  };
}

describe('dev items window', () => {
  it.each(['/', '/?dev=0'])('hides and blocks dev commands at %s', (url) => {
    window.history.replaceState({}, '', url);
    const { world, host, change, dispose } = setup();
    try {
      expect(host.innerHTML).toBe('');
      uiCommands()?.setDevItemsOpen(true);
      uiCommands()?.devGiveItem('copper', 1);
      world.tick();
      expect(isDevItemsOpen()).toBe(false);
      expect(change).not.toHaveBeenCalled();
      expect(world.entities.size).toBe(1);
    } finally { dispose(); }
  });

  it('lists the full catalog, selects quantity, and dispatches grants only on the sim tick', () => {
    const { world, player, host, change, closePrinter, open, dispose } = setup();
    try {
      open();
      expect(host.querySelector('dialog')?.open).toBe(true);
      expect(host.querySelectorAll('.dev-item-row')).toHaveLength(ITEMS.length);
      expect(change).toHaveBeenLastCalledWith(true);
      expect(closePrinter).toHaveBeenCalled();
      const quantity = host.querySelector('select')!;
      quantity.value = String(DEV_ITEM_MAX_COUNT);
      flushSync(() => quantity.dispatchEvent(new Event('change', { bubbles: true })));
      flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="Give Copper"]')!.click());
      expect(world.entities.size).toBe(1);
      world.tick();
      expect(player.components.inventory?.slots.filter(Boolean)).toHaveLength(DEV_ITEM_MAX_COUNT);
      expect([...world.entities.values()].filter((e) => e.components.item?.itemId === 'copper')).toHaveLength(DEV_ITEM_MAX_COUNT);
      expect(host.querySelector('[role="status"]')?.textContent).toContain('8 × Copper');
    } finally { dispose(); }
  });

  it('closes on Escape without passing game shortcuts to window and resets between sessions', () => {
    const { host, change, open, dispose } = setup();
    const gameKey = vi.fn();
    window.addEventListener('keydown', gameKey);
    try {
      open();
      const input = host.querySelector('input')!;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', bubbles: true }));
      expect(gameKey).not.toHaveBeenCalled();
      flushSync(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })));
      expect(isDevItemsOpen()).toBe(false);
      expect(host.querySelector('dialog')).toBeNull();
      expect(change).toHaveBeenLastCalledWith(false);
      open();
      flushSync(resetUiCommands);
      expect(isDevItemsOpen()).toBe(false);
      expect(host.innerHTML).toBe('');
    } finally { window.removeEventListener('keydown', gameKey); dispose(); }
  });

  it('filters by name or ID, shows no matches, and closes using the button', () => {
    const { host, open, dispose } = setup();
    try {
      open();
      const input = host.querySelector('input')!;
      const search = (value: string) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        flushSync(() => input.dispatchEvent(new Event('input', { bubbles: true })));
      };
      search('  COPPER  ');
      expect(host.querySelectorAll('.dev-item-row')).toHaveLength(1);
      expect(host.querySelector('[aria-label="Give Copper"]')).not.toBeNull();
      search('shuttle_package');
      expect(host.querySelectorAll('.dev-item-row')).toHaveLength(1);
      expect(host.querySelector('[aria-label="Give Shuttle (packaged)"]')).not.toBeNull();
      search('does not exist');
      expect(host.textContent).toContain('No matching items.');
      flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="Close dev items"]')!.click());
      expect(host.querySelector('dialog')).toBeNull();
    } finally { dispose(); }
  });

  it('is hidden while the pause menu is active', () => {
    const { host, dispose } = setup();
    try {
      flushSync(() => useMenuStore.setState({ view: { kind: 'pause', options: {
        onResume: () => undefined, onSaveNow: async () => true, onQuitToMenu: async () => true,
      } } }));
      expect(host.innerHTML).toBe('');
    } finally { dispose(); }
  });
});
