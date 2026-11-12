// Drag ghost: a fixed, pointer-events:none label at the cursor. Mounted once
// at the UI root (never inside a slot, or elementFromPoint would hit it).

import { useDragStore } from '../stores/dragStore.js';

export function DragGhost() {
  const active = useDragStore((s) => s.active);
  const x = useDragStore((s) => s.x);
  const y = useDragStore((s) => s.y);
  const ok = useDragStore((s) => s.hoverOk);
  const label = useDragStore((s) => s.label);
  if (!active) return null;
  return (
    <div id="drag-ghost" className={ok ? 'ok' : 'bad'} style={{ left: x + 14, top: y + 10 }}>
      <span className="drag-swatch" style={{ background: active.payload.color }} />
      <span>{active.payload.name}</span>
      {label ? <span className="drag-label">{label}</span> : null}
    </div>
  );
}
