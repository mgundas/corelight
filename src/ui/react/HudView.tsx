// HUD (React port): oxygen bar, tether indicator, backpack slot bar, soil,
// power readout, prompt and navigation hints. Renders only the projection
// pushed by the Game; slot drags go through InventorySlot.

import { useHudStore } from '../stores/hudStore.js';
import { arrowForBearing, type NavHint } from '../../game/oxygenStatus.js';
import { InventorySlot } from './InventorySlot.js';

function hintText(hint: NavHint | null): string {
  if (!hint) return '';
  return `${hint.label} ${Math.round(hint.distM)}m ${arrowForBearing(hint.bearingDeg)}`;
}

export function HudView() {
  const slots = useHudStore((s) => s.slots);
  const selectedSlot = useHudStore((s) => s.selectedSlot);
  const soil = useHudStore((s) => s.soil);
  const prompt = useHudStore((s) => s.prompt);
  const oxygen = useHudStore((s) => s.oxygen);
  const onNetwork = useHudStore((s) => s.onNetwork);
  const habitatHint = useHudStore((s) => s.habitatHint);
  const deathHint = useHudStore((s) => s.deathHint);
  const power = useHudStore((s) => s.power);
  const toolMode = useHudStore((s) => s.toolMode);
  const brushMode = useHudStore((s) => s.brushMode);
  const deathFadeToken = useHudStore((s) => s.deathFadeToken);
  const toast = useHudStore((s) => s.toast);
  const toastToken = useHudStore((s) => s.toastToken);

  const navParts = [hintText(habitatHint), hintText(deathHint)].filter((part) => part !== '');
  return (
    <>
      <div id="hud">
        <div id="hud-oxygen" className={oxygen < 25 ? 'low' : ''} title={`Oxygen ${Math.ceil(oxygen)}`}>
          <div id="hud-oxygen-fill" style={{ width: `${Math.max(0, Math.min(100, oxygen))}%` }} />
        </div>
        <div id="hud-tether" className={onNetwork ? 'live' : ''}>
          {onNetwork ? 'O₂ ●' : 'O₂ ○'}
        </div>
        <div id="hud-mode" className={toolMode === 'deform' ? 'deform' : ''}>
          {toolMode === 'deform' ? `Q: tool on · ${brushMode === 'dig' ? 'Dig' : 'Add'} (X)` : 'Q: terrain tool'}
        </div>
        <div id="hud-slots">
          {Array.from({ length: 8 }, (_, i) => (
            <InventorySlot
              key={i}
              index={i}
              slot={slots[i] ?? null}
              selected={i === selectedSlot}
            />
          ))}
        </div>
        <div id="hud-soil">Soil {soil}</div>
        {power ? (
          <div id="hud-power" className={power.state === 'paused' ? 'paused' : ''}>
            ⚡ {power.generation.toFixed(1)}/s in · {power.demand.toFixed(1)}/s out ·{' '}
            {Math.round(power.stored)}/{Math.round(power.capacity)} stored ·{' '}
            {power.state === 'paused' ? 'paused: no power' : power.state}
          </div>
        ) : null}
        {prompt ? <div id="hud-prompt">{prompt}</div> : null}
        {toast ? (
          <div key={toastToken} id="hud-toast">
            {toast}
          </div>
        ) : null}
        {navParts.length > 0 ? <div id="hud-nav">{navParts.join('   ')}</div> : null}
      </div>
      <div key={deathFadeToken} id="death-fade" className={deathFadeToken > 0 ? 'run' : ''} />
    </>
  );
}
