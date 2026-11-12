// Mount the React UI once at boot. Returns a dispose handle for tests/HMR.

import { createRoot, type Root } from 'react-dom/client';
import { UiRoot } from './UiRoot.js';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

export function mountUi(): () => void {
  if (root) return () => undefined;
  host = document.createElement('div');
  host.id = 'ui-root';
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<UiRoot />);
  return () => {
    root?.unmount();
    root = null;
    host?.remove();
    host = null;
  };
}
