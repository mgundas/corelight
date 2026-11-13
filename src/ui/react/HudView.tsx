import { useHudStore } from '../stores/hudStore.js';
import { useMenuStore } from '../stores/menuStore.js';
import { arrowForBearing, type NavHint } from '../../game/oxygenStatus.js';
import { InventorySlot } from './InventorySlot.js';
import { SOIL_MAX } from '../../core/constants.js';

function hintText(hint: NavHint | null): string {
  if (!hint) return '';
  return `${arrowForBearing(hint.bearingDeg)} ${hint.label} · ${Math.round(hint.distM)} m`;
}

function distanceText(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function HudView() {
  const state = useHudStore();
  const menuOpen = useMenuStore((s) => s.view.kind !== 'none');
  const { slots, selectedSlot, soil, prompt, oxygen, onNetwork, heat, cold,
    habitatHint, deathHint, power, toolMode, brushMode, drillTier, flight,
    deathFadeToken, toast, toastToken } = state;
  const equipped = toolMode === 'deform';
  const modeLabel = state.interactionMode === 'cable' ? 'Cable tool'
    : state.interactionMode === 'place' ? 'Place structure'
    : state.interactionMode === 'carry' ? 'Carrying item'
    : equipped ? `${brushMode === 'dig' ? 'Dig' : 'Add'} · tool on` : 'Explore';
  const modeHelp = state.interactionMode === 'cable' || state.interactionMode === 'place' ? 'E: exit mode'
    : state.interactionMode === 'carry' ? 'LMB: release item'
    : equipped ? 'Q: stow terrain tool' : 'Q: terrain tool';
  const o2 = Math.max(0, Math.min(100, oxygen));
  const navParts = [hintText(habitatHint), hintText(deathHint)].filter(Boolean);
  return (
    <>
      <div id="hud" hidden={menuOpen}>
        <section className="suit-panel" aria-label="Suit status">
          <div className="eyebrow">SUIT TELEMETRY <span className="status-dot" /></div>
          <div className="oxygen-readout"><span>O<span className="subscript">2</span></span><strong>{Math.ceil(o2)}<small>%</small></strong></div>
          <div id="hud-oxygen" className={o2 < 25 ? 'low' : ''}
            role="progressbar" aria-label="Oxygen" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.ceil(o2)}>
            <div id="hud-oxygen-fill" style={{ width: `${o2}%` }} />
          </div>
          <div id="hud-tether" className={onNetwork ? 'live' : ''}>
            <span className="network-dot" />{onNetwork ? 'Tether connected' : o2 < 25 ? 'Oxygen low · return to a tether' : 'Using suit oxygen'}
          </div>
          {heat || cold ? <div className="hazard-label">{heat ? 'Heat exposure' : 'Cold exposure'} · increased O₂ use</div> : null}
        </section>
        <aside className="field-panel">
          <div className="eyebrow">FIELD EQUIPMENT</div>
          <div id="hud-mode" className={equipped ? 'deform' : ''}>
            <span className="mode-glyph" aria-hidden="true">{equipped ? '◈' : '⌖'}</span>
            <div><strong>{modeLabel}</strong><small>{modeHelp}</small></div>
          </div>
          <div className="equipment-meta"><span id="hud-drill">Drill Mk{drillTier}</span><span id="hud-soil">Soil {soil} / {SOIL_MAX}</span></div>
          {equipped ? <div className="brush-controls"><kbd>LMB</kbd> use <kbd>X</kbd> dig / add<br /><kbd>F</kbd> hold to flatten <kbd>Ctrl + wheel</kbd> size</div> : null}
          {navParts.length > 0 ? <div id="hud-nav">{navParts.map((part) => <div key={part}>{part}</div>)}</div> : null}
        </aside>
        {flight ? (
          <aside className="flight-panel" aria-label="Flight instruments">
            <div className="eyebrow">FLIGHT <span className="status-dot" /></div>
            <div className="flight-main">
              <strong>{Math.round(flight.speedMps)}<small> m/s</small></strong>
              <span>ALT {distanceText(flight.altitudeM)}</span>
              <span className="flight-fuel">FUEL {flight.fuel}/{flight.maxFuel}</span>
            </div>
            {flight.launchCharge > 0 ? (
              <div id="flight-launch" role="progressbar" aria-label="Launch charge"
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(flight.launchCharge * 100)}>
                <div style={{ width: `${flight.launchCharge * 100}%` }} />
              </div>
            ) : null}
            <div className="flight-markers">
              {flight.planets.map((marker) => (
                <div key={`planet:${marker.label}`} className="flight-marker">
                  <span>{!flight.landed ? arrowForBearing(marker.bearingDeg) : '●'} {marker.label}</span>
                  <span>{distanceText(marker.distanceM)}</span>
                </div>
              ))}
              {flight.habitats.map((marker, index) => (
                <div key={`base:${marker.label}:${index}`} className="flight-marker base">
                  <span>{marker.samePlanet ? arrowForBearing(marker.bearingDeg) : '◆'} {marker.label}</span>
                  <span>{distanceText(marker.distanceM)}</span>
                </div>
              ))}
            </div>
            <div className="flight-hint">
              Mouse steer · A/D yaw · RMB free-look<br />
              <kbd>Space</kbd> {flight.landed ? 'hold 2 s to launch' : 'lift'} · <kbd>Shift</kbd> boost · <kbd>E</kbd> {flight.landed ? 'disembark' : 'land to disembark'}
            </div>
          </aside>
        ) : null}
        {power ? <div id="hud-power" className={power.state === 'paused' ? 'paused' : ''}>
          <span className="eyebrow">POWER NETWORK</span>
          <strong>{power.state === 'paused' ? 'Paused · no power' : power.state}</strong>
          <span>{power.generation.toFixed(1)}/s in · {power.demand.toFixed(1)}/s out</span>
          <span>{Math.round(power.stored)} / {Math.round(power.capacity)} stored</span>
        </div> : null}
        <div className="action-feedback">
          {toast ? <div key={toastToken} id="hud-toast" role="status">{toast}</div> : null}
          {prompt ? <div id="hud-prompt">{prompt}</div> : null}
        </div>
        <div className="backpack-dock">
          <div className="dock-heading"><span className="eyebrow">BACKPACK <span className="muted">{slots.filter(Boolean).length} / 8</span></span><span><kbd>Tab</kbd> printer</span></div>
          <div id="hud-slots" aria-label="Backpack slots">
            {Array.from({ length: 8 }, (_, i) => <InventorySlot key={i} index={i} slot={slots[i] ?? null} selected={i === selectedSlot} />)}
          </div>
          <div className="dock-footer"><span><kbd>RMB</kbd> hold to look <span className="separator">/</span> <kbd>Wheel</kbd> zoom</span><span><kbd>T</kbd> tether <kbd>L</kbd> lamp <kbd>Esc</kbd> menu</span></div>
        </div>
      </div>
      <div id="heat-haze" className={heat ? 'on' : ''} />
      <div id="cold-tint" className={cold ? 'on' : ''} />
      <div key={deathFadeToken} id="death-fade" className={deathFadeToken > 0 ? 'run' : ''} />
    </>
  );
}
