// Printer UI (M09): plain DOM panel for the backpack printer (Tab) and a
// looked-at station (E). Shows every recipe, the inputs with have/need
// counts, greyed locked recipes, station input slots and job progress.
// Read-only over the World; handlers dispatch Actions in Game.

export interface PrinterRowInput {
  name: string;
  need: number;
  have: number;
}

export interface PrinterRow {
  recipeId: string;
  name: string;
  inputs: PrinterRowInput[];
  locked: boolean;
  enabled: boolean;
  timeS: number;
}

export interface StationPanel {
  stationId: string;
  name: string;
  /** Loaded input item names, padded with null to STATION_INPUT_SLOTS. */
  slots: (string | null)[];
  job: { name: string; progress: number; time: number } | null;
  outputName: string | null;
}

export interface PrinterUiState {
  mode: 'backpack' | 'station';
  title: string;
  hint: string;
  station: StationPanel | null;
  rows: PrinterRow[];
}

export interface PrinterUiHandlers {
  onPrintBackpack(recipeId: string): void;
  onPrintStation(stationId: string, recipeId: string): void;
  onCollect(stationId: string): void;
}

export class PrinterUi {
  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly stationEl: HTMLDivElement;
  private readonly rowsEl: HTMLDivElement;
  private readonly handlers: PrinterUiHandlers;
  private open = false;
  private mode: 'backpack' | 'station' = 'backpack';
  private stationId: string | null = null;
  private lastKey = '';

  constructor(handlers: PrinterUiHandlers) {
    this.handlers = handlers;
    this.root = document.createElement('div');
    this.root.id = 'printer-ui';
    this.root.hidden = true;
    const header = document.createElement('div');
    header.id = 'printer-header';
    this.titleEl = document.createElement('div');
    this.titleEl.id = 'printer-title';
    const close = document.createElement('button');
    close.type = 'button';
    close.id = 'printer-close';
    close.textContent = '×';
    close.title = 'Close (Tab)';
    close.addEventListener('click', () => this.close());
    header.append(this.titleEl, close);
    this.hintEl = document.createElement('div');
    this.hintEl.id = 'printer-hint';
    this.stationEl = document.createElement('div');
    this.stationEl.id = 'printer-station';
    this.rowsEl = document.createElement('div');
    this.rowsEl.id = 'printer-rows';
    this.root.append(header, this.hintEl, this.stationEl, this.rowsEl);
    document.body.appendChild(this.root);
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Station id while showing a station panel, null for the backpack. */
  openStationId(): string | null {
    return this.mode === 'station' ? this.stationId : null;
  }

  openBackpack(): void {
    this.open = true;
    this.mode = 'backpack';
    this.stationId = null;
    this.lastKey = '';
    this.root.hidden = false;
    this.releasePointerLock();
  }

  openStation(stationId: string): void {
    this.open = true;
    this.mode = 'station';
    this.stationId = stationId;
    this.lastKey = '';
    this.root.hidden = false;
    this.releasePointerLock();
  }

  close(): void {
    this.open = false;
    this.stationId = null;
    this.root.hidden = true;
    this.lastKey = '';
  }

  /** Reconcile the panel with a fresh read-only state snapshot. */
  sync(state: PrinterUiState): void {
    if (!this.open) return;
    const key = JSON.stringify({
      mode: state.mode,
      title: state.title,
      hint: state.hint,
      station: state.station,
      rows: state.rows,
    });
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.titleEl.textContent = state.title;
    this.hintEl.textContent = state.hint;
    this.renderStation(state.station);
    this.rowsEl.replaceChildren();
    for (const row of state.rows) {
      this.rowsEl.appendChild(this.renderRow(row, state.station?.stationId ?? null));
    }
  }

  private renderStation(station: StationPanel | null): void {
    this.stationEl.replaceChildren();
    this.stationEl.hidden = station === null;
    if (!station) return;
    const slots = document.createElement('div');
    slots.className = 'printer-slots';
    for (const name of station.slots) {
      const slot = document.createElement('div');
      slot.className = name ? 'printer-slot filled' : 'printer-slot';
      slot.textContent = name ?? '·';
      slots.appendChild(slot);
    }
    this.stationEl.appendChild(slots);
    if (station.job) {
      const job = document.createElement('div');
      job.className = 'printer-job';
      const label = document.createElement('span');
      label.textContent = `${station.job.name} ${Math.floor((station.job.progress / Math.max(0.001, station.job.time)) * 100)}%`;
      const bar = document.createElement('div');
      bar.className = 'printer-bar';
      const fill = document.createElement('div');
      fill.className = 'printer-bar-fill';
      fill.style.width = `${Math.min(100, (station.job.progress / Math.max(0.001, station.job.time)) * 100)}%`;
      bar.appendChild(fill);
      job.append(label, bar);
      this.stationEl.appendChild(job);
    }
    if (station.outputName) {
      const collect = document.createElement('button');
      collect.type = 'button';
      collect.className = 'printer-collect';
      collect.textContent = `Collect ${station.outputName}`;
      collect.addEventListener('click', () => this.handlers.onCollect(station.stationId));
      this.stationEl.appendChild(collect);
    }
  }

  private renderRow(row: PrinterRow, stationId: string | null): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'printer-row';
    el.classList.toggle('locked', row.locked);
    const name = document.createElement('div');
    name.className = 'printer-row-name';
    name.textContent = row.locked ? `${row.name} (locked)` : row.name;
    const inputs = document.createElement('div');
    inputs.className = 'printer-row-inputs';
    inputs.textContent = row.inputs
      .map((input) => `${input.have}/${input.need} ${input.name}`)
      .join('  ·  ');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'printer-print';
    button.textContent = 'Print';
    button.disabled = !row.enabled;
    button.addEventListener('click', () => {
      if (stationId) this.handlers.onPrintStation(stationId, row.recipeId);
      else this.handlers.onPrintBackpack(row.recipeId);
    });
    el.append(name, inputs, button);
    return el;
  }

  private releasePointerLock(): void {
    // The panel needs the cursor; a click on the canvas re-locks it on close.
    if (document.pointerLockElement) document.exitPointerLock();
  }

  dispose(): void {
    this.root.remove();
  }
}
