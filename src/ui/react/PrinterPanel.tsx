// Printer panel (React port): backpack (Tab) and station (E) recipe lists,
// have/need counts, locked rows, station input slots (drop targets) and job
// progress. Presentation only: buttons call the UI command bridge.

import { useCommandsStore } from '../stores/commandsStore.js';
import { useDragStore } from '../stores/dragStore.js';
import { useHudStore } from '../stores/hudStore.js';
import { usePrinterStore } from '../stores/printerStore.js';
import { slotHoverKey } from '../drag/inventoryDrag.js';
import { InventorySlot } from './InventorySlot.js';
import type { PrinterRow, StationPanel } from '../printerUi.js';

function BackpackGrid() {
  const slots = useHudStore((s) => s.slots);
  const selected = useHudStore((s) => s.selectedSlot);
  return (
    <div className="bag-grid">
      {Array.from({ length: 8 }, (_, i) => (
        <InventorySlot
          key={i}
          index={i}
          slot={slots[i] ?? null}
          selected={i === selected}
          variant="panel"
          showNumber={false}
        />
      ))}
    </div>
  );
}

function StationSlots({ station }: { station: StationPanel }) {
  return (
    <div className="printer-slots">
      {station.slots.map((name, index) => (
        <StationSlot
          key={index}
          stationId={station.stationId}
          index={index}
          name={name}
          itemId={station.inputIds[index] ?? null}
          canUnload={station.canUnload}
        />
      ))}
    </div>
  );
}

function StationSlot({ stationId, index, name, itemId, canUnload }: {
  stationId: string; index: number; name: string | null; itemId: string | null; canUnload: boolean;
}) {
  const commands = useCommandsStore((s) => s.commands);
  const hoverKey = slotHoverKey('station', index, stationId);
  const hovered = useDragStore((s) => s.hoverKey === hoverKey);
  const hoverOk = useDragStore((s) => s.hoverOk);
  const classes = ['printer-slot'];
  if (name) classes.push('filled');
  if (hovered) classes.push(hoverOk ? 'drop-ok' : 'drop-bad');
  return (
    <div className={classes.join(' ')} data-drop={`station:${stationId}:${index}`}>
      {name ?? '·'}
      {name && itemId ? (
        <button
          type="button"
          className="printer-unload"
          aria-label={`Unload ${name}`}
          title={canUnload ? `Return ${name} to backpack` : 'Backpack full — free a slot to unload'}
          disabled={!canUnload}
          onClick={() => commands?.unloadStationInput(stationId, itemId)}
        >
          Unload
        </button>
      ) : null}
    </div>
  );
}

function RecipeRow({ row, stationId }: { row: PrinterRow; stationId: string | null }) {
  const commands = useCommandsStore((s) => s.commands);
  return (
    <div className={`printer-row${row.locked ? ' locked' : ''}`}>
      <div className="printer-row-name">{row.locked ? `${row.name} (locked)` : row.name}</div>
      <div className="printer-row-inputs">
        {row.inputs.map((input) => `${input.have}/${input.need} ${input.name}`).join('  ·  ')}
      </div>
      <button
        type="button"
        className="printer-print"
        disabled={!row.enabled}
        onClick={() => {
          if (stationId) commands?.printStation(stationId, row.recipeId);
          else commands?.printBackpack(row.recipeId);
        }}
      >
        Print
      </button>
    </div>
  );
}

export function PrinterPanel() {
  const open = usePrinterStore((s) => s.open);
  const view = usePrinterStore((s) => s.view);
  const commands = useCommandsStore((s) => s.commands);
  if (!open || !view) return null;
  const station = view.station;
  return (
    <div id="printer-ui">
      <div id="printer-header">
        <div id="printer-title">{view.title}</div>
        <button type="button" id="printer-close" title="Close (Tab)" onClick={() => commands?.closePrinter()}>
          ×
        </button>
      </div>
      <div id="printer-hint">{view.hint}</div>
      {view.mode === 'backpack' ? <BackpackGrid /> : null}
      {station ? (
        <div id="printer-station">
          <StationSlots station={station} />
          {!station.canUnload && station.inputIds.some(Boolean) ? (
            <p className="printer-unload-hint">Backpack full — free a slot to unload materials.</p>
          ) : null}
          {station.job ? (
            <div className="printer-job">
              <span>
                {station.job.name}{' '}
                {Math.floor((station.job.progress / Math.max(0.001, station.job.time)) * 100)}%
              </span>
              <div className="printer-bar">
                <div
                  className="printer-bar-fill"
                  style={{
                    width: `${Math.min(100, (station.job.progress / Math.max(0.001, station.job.time)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
          {station.outputName ? (
            <button
              type="button"
              className="printer-collect"
              onClick={() => commands?.collectStation(station.stationId)}
            >
              Collect {station.outputName}
            </button>
          ) : null}
        </div>
      ) : null}
      <div id="printer-rows">
        {view.rows.map((row) => (
          <RecipeRow key={row.recipeId} row={row} stationId={station?.stationId ?? null} />
        ))}
      </div>
    </div>
  );
}
