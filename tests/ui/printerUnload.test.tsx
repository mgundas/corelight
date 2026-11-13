// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { buildPrinterState } from '../../src/game/printerWiring.js';
import { installUiCommands } from '../../src/game/uiCommands.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { giveItemToPlayer } from '../../src/sim/inventoryActions.js';
import { World } from '../../src/sim/world.js';
import { PrinterPanel } from '../../src/ui/react/PrinterPanel.js';
import { resetUiCommands } from '../../src/ui/stores/commandsStore.js';
import { resetPrinterStore, usePrinterStore } from '../../src/ui/stores/printerStore.js';

afterEach(() => { resetUiCommands(); resetPrinterStore(); });

function renderStation(fullBackpack = false) {
  const world = new World(1337, { planets: [SELA] });
  world.dispatch({ type: 'spawnPlayer', planetId: SELA.id, position: { x: 0, y: 402, z: 0 } });
  world.tick();
  const player = [...world.entities.values()][0]!;
  const stationId = world.nextId('machine');
  const printer = { inputs: [] as string[], recipeId: null, progressS: 0, outputReady: null };
  world.entities.set(stationId, {
    id: stationId, kind: 'machine', planetId: SELA.id,
    position: { ...player.position }, rotation: { ...IDENTITY_QUAT },
    components: { machine: { machineType: 'small_printer' }, printer },
  });
  giveItemToPlayer(world, player, 'silicate');
  const itemId = player.components.inventory!.slots[0]!;
  world.dispatch({ type: 'depositSlotToStation', playerId: player.id, stationId, slot: 0 });
  world.tick();
  if (fullBackpack) for (let i = 0; i < 8; i++) giveItemToPlayer(world, player, 'resin');
  installUiCommands(world, () => player.id, () => undefined, () => undefined);
  usePrinterStore.setState({ open: true, view: buildPrinterState(world, player.id, stationId) });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(<PrinterPanel />));
  return { world, player, printer, itemId, host,
    dispose: () => { flushSync(() => root.unmount()); host.remove(); } };
}

describe('printer unload controls', () => {
  it('clicks through the real command bridge and only transfers the material on the sim tick', () => {
    const { world, player, printer, itemId, host, dispose } = renderStation();
    try {
      const button = host.querySelector<HTMLButtonElement>('button[aria-label="Unload Silicate"]');
      expect(button).not.toBeNull();
      expect(button?.disabled).toBe(false);
      expect(host.querySelectorAll('.printer-unload')).toHaveLength(1);
      button!.click();
      button!.click();
      expect(printer.inputs).toEqual([itemId]);
      world.tick();
      expect(printer.inputs).toEqual([]);
      expect(player.components.inventory?.slots.filter((id) => id === itemId)).toHaveLength(1);
    } finally { dispose(); }
  });

  it('disables unloading with a visible explanation when the backpack is full', () => {
    const { world, printer, itemId, host, dispose } = renderStation(true);
    try {
      const button = host.querySelector<HTMLButtonElement>('button[aria-label="Unload Silicate"]');
      expect(button?.disabled).toBe(true);
      expect(host.textContent).toContain('Backpack full — free a slot to unload materials.');
      button!.click();
      world.tick();
      expect(printer.inputs).toEqual([itemId]);
    } finally { dispose(); }
  });
});
