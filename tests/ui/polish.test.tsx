// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MenuViews } from '../../src/ui/react/MenuViews.js';
import { HudView } from '../../src/ui/react/HudView.js';
import { resetHudView, useHudStore } from '../../src/ui/stores/hudStore.js';
import { useMenuStore } from '../../src/ui/stores/menuStore.js';

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  if (root) flushSync(() => root?.unmount());
  host?.remove(); root = null; host = null;
  resetHudView(); useMenuStore.setState({ view: { kind: 'none' } });
});

function mount() {
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
  flushSync(() => root?.render(<><HudView /><MenuViews /></>));
  return host;
}

describe('polished overlays', () => {
  it('keeps the paused session available when saving on quit fails', async () => {
    const quit = vi.fn(async () => false);
    useMenuStore.setState({ view: { kind: 'pause', options: {
      onResume: () => undefined, onSaveNow: async () => true, onQuitToMenu: quit,
    } } });
    const host = mount();
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Save & quit'));
    expect(button).toBeDefined();
    await act(async () => { button?.click(); });
    expect(quit).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('Your progress could not be saved');
    expect(button?.disabled).toBe(false);
    expect(host.querySelector('#hud')?.hasAttribute('hidden')).toBe(true);
  });

  it('shows low oxygen and cable mode explicitly rather than relying only on color', () => {
    useMenuStore.setState({ view: { kind: 'none' } });
    useHudStore.setState({ oxygen: 15, onNetwork: false, interactionMode: 'cable' });
    const host = mount();
    expect(host.textContent).toContain('Oxygen low · return to a tether');
    expect(host.textContent).toContain('Cable tool');
    expect(host.textContent).toContain('E: exit mode');
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('15');
    expect(host.querySelectorAll('#hud-slots button')).toHaveLength(8);
  });
});
