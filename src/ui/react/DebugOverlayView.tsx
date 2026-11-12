// F1 debug overlay (React port). Text is formatted once by the overlay
// controller; this component only paints it.

import { useOverlayStore } from '../stores/overlayStore.js';

export function DebugOverlayView() {
  const visible = useOverlayStore((s) => s.visible);
  const text = useOverlayStore((s) => s.text);
  if (!visible) return null;
  return <div id="debug-overlay">{text}</div>;
}
