// @vitest-environment jsdom
// React UI smoke tests (real DOM via jsdom): the root renders without
// crashing and exposes the drag/drop data attributes the pointer drag uses.

import { beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { UiRoot } from '../../src/ui/react/UiRoot.js';
import { resetHudView, useHudStore } from '../../src/ui/stores/hudStore.js';
import { resetPrinterStore, usePrinterStore } from '../../src/ui/stores/printerStore.js';
import { resetResearchStore, useResearchStore } from '../../src/ui/stores/researchStore.js';
import { resetDragStore, useDragStore } from '../../src/ui/stores/dragStore.js';
import { resetOverlayStore } from '../../src/ui/stores/overlayStore.js';
import { useMenuStore } from '../../src/ui/stores/menuStore.js';

function renderUi(): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(<UiRoot />));
  const html = host.innerHTML;
  flushSync(() => root.unmount());
  host.remove();
  return html;
}

beforeEach(() => {
  resetHudView();
  resetPrinterStore();
  resetResearchStore();
  resetDragStore();
  resetOverlayStore();
  useMenuStore.setState({ view: { kind: 'none' } });
});

describe('React UI root', () => {
  it('renders the HUD slot bar as bag drop targets', () => {
    useHudStore.setState({
      slots: [{ itemId: 'resin', name: 'Resin', color: '#c58b4a' }],
      selectedSlot: 0,
    });
    const html = renderUi();
    expect(html).toContain('data-drop="bag:0"');
    expect(html).toContain('data-drop="bag:7"');
    expect(html).toContain('Resin');
    expect(html).toContain('Q: terrain tool');
  });

  it('renders the tool mode chip when equipped', () => {
    useHudStore.setState({ toolMode: 'deform', brushMode: 'add' });
    const html = renderUi();
    expect(html).toContain('tool on');
    expect(html).toContain('Add');
  });

  it('renders station input slots as station drop targets', () => {
    usePrinterStore.setState({
      open: true,
      mode: 'station',
      stationId: 'machine_x',
      view: {
        mode: 'station',
        title: 'Small printer',
        hint: 'test',
        station: {
          stationId: 'machine_x',
          name: 'Small printer',
          slots: [null, null],
          acceptsItemIds: ['silicate'],
          job: null,
          outputName: null,
        },
        rows: [],
      },
    });
    const html = renderUi();
    expect(html).toContain('data-drop="station:machine_x:0"');
    expect(html).toContain('data-drop="station:machine_x:1"');
  });

  it('renders the drag ghost only while a drag is active', () => {
    useDragStore.setState({
      active: {
        source: { zone: 'bag', index: 0 },
        payload: { itemId: 'resin', name: 'Resin', color: '#c58b4a' },
      },
      x: 10,
      y: 20,
      label: 'Move here',
      hoverOk: true,
    });
    const html = renderUi();
    expect(html).toContain('id="drag-ghost"');
    expect(html).toContain('Move here');
  });

  it('renders the research tree, sample drop slot and unlock buttons', () => {
    useResearchStore.setState({
      open: true,
      stationId: 'machine_x',
      view: {
        title: 'Research station',
        hint: 'Analyzing',
        data: 25,
        station: {
          stationId: 'machine_x',
          name: 'Research station',
          slots: [null],
          acceptsItemIds: ['research_sample'],
          hasInput: false,
          progressS: 0,
          timeS: 20,
          dataReady: 0,
          paused: false,
        },
        rows: [
          {
            id: 'power_basics',
            name: 'Power basics',
            description: 'Solar panels and batteries.',
            cost: 20,
            requires: [],
            state: 'available',
            enabled: true,
          },
          {
            id: 'drill_mk3',
            name: 'Drill Mk3',
            description: 'Core shell drill.',
            cost: 40,
            requires: ['Drill Mk2'],
            state: 'locked',
            enabled: false,
          },
        ],
      },
    });
    const html = renderUi();
    expect(html).toContain('data-drop="station:machine_x:0"');
    expect(html).toContain('Power basics');
    expect(html).toContain('Requires: Drill Mk2');
    expect(html).toContain('Unlock');
    expect(html).toContain('Data:');
  });

  it('renders an unlock toast', () => {
    useHudStore.setState({ toast: 'New blueprint: Solar panel', toastToken: 1 });
    const html = renderUi();
    expect(html).toContain('id="hud-toast"');
    expect(html).toContain('New blueprint: Solar panel');
  });

  it('renders the main menu from the store', () => {
    useMenuStore.setState({
      view: {
        kind: 'main',
        options: {
          hasSave: true,
          onContinue: () => undefined,
          onNewGame: () => undefined,
        },
      },
    });
    const html = renderUi();
    expect(html).toContain('Corelight');
    expect(html).toContain('Continue');
    expect(html).toContain('New game');
  });
});
