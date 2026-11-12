// Research panel (M11, React port): Data balance, the station's single sample
// slot (a drag target), analysis progress and the unlock tree with costs and
// prerequisites. Presentation only: buttons call the UI command bridge.

import { useCommandsStore } from '../stores/commandsStore.js';
import { useDragStore } from '../stores/dragStore.js';
import { useResearchStore } from '../stores/researchStore.js';
import { slotHoverKey } from '../drag/inventoryDrag.js';
import type { ResearchRow, ResearchStationPanel } from '../researchUi.js';

function SampleSlot({ station }: { station: ResearchStationPanel }) {
  const hoverKey = slotHoverKey('station', 0, station.stationId);
  const hovered = useDragStore((s) => s.hoverKey === hoverKey);
  const hoverOk = useDragStore((s) => s.hoverOk);
  const name = station.slots[0] ?? null;
  const classes = ['printer-slot'];
  if (name) classes.push('filled');
  if (hovered) classes.push(hoverOk ? 'drop-ok' : 'drop-bad');
  return (
    <div className="research-slot-row">
      <div className="research-slot-label">Sample</div>
      <div className={classes.join(' ')} data-drop={`station:${station.stationId}:0`}>
        {name ?? 'Drop a research sample'}
      </div>
    </div>
  );
}

function Progress({ station }: { station: ResearchStationPanel }) {
  const pct = Math.min(100, (station.progressS / Math.max(0.001, station.timeS)) * 100);
  return (
    <div className="printer-job">
      <span>
        {station.paused ? 'Paused' : 'Analyzing'} {Math.floor(pct)}%
      </span>
      <div className="printer-bar">
        <div className="printer-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Row({ row }: { row: ResearchRow }) {
  const commands = useCommandsStore((s) => s.commands);
  const classes = ['printer-row', `research-${row.state}`];
  let action = 'Unlocked';
  if (row.state === 'available') action = 'Unlock';
  else if (row.state === 'locked') action = 'Locked';
  return (
    <div className={classes.join(' ')}>
      <div className="printer-row-name">{row.name}</div>
      <div className="printer-row-inputs">
        {row.description}
        {row.state !== 'unlocked' && row.requires.length > 0
          ? `  ·  Requires: ${row.requires.join(', ')}`
          : ''}
      </div>
      <div className="research-cost">
        {row.state === 'unlocked' ? '✓' : `${row.cost} Data`}
        {row.state === 'available' ? (
          <button
            type="button"
            className="printer-print"
            disabled={!row.enabled}
            onClick={() => commands?.unlockResearch(row.id)}
          >
            Unlock
          </button>
        ) : (
          <span className="research-state">{action}</span>
        )}
      </div>
    </div>
  );
}

export function ResearchPanel() {
  const open = useResearchStore((s) => s.open);
  const view = useResearchStore((s) => s.view);
  const commands = useCommandsStore((s) => s.commands);
  if (!open || !view) return null;
  const station = view.station;
  return (
    <div id="research-ui">
      <div id="printer-header">
        <div id="printer-title">{view.title}</div>
        <button
          type="button"
          id="printer-close"
          title="Close (Tab)"
          onClick={() => commands?.closeResearch()}
        >
          ×
        </button>
      </div>
      <div id="printer-hint">
        {view.hint} Data: <strong>{view.data}</strong>
      </div>
      <div id="printer-station">
        <SampleSlot station={station} />
        {station.hasInput ? <Progress station={station} /> : null}
        {station.dataReady > 0 ? (
          <button
            type="button"
            className="printer-collect"
            onClick={() => commands?.collectResearch(station.stationId)}
          >
            Collect {station.dataReady} Data
          </button>
        ) : null}
      </div>
      <div id="printer-rows">
        {view.rows.map((row) => (
          <Row key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}
