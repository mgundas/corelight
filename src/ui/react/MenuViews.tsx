import { useState } from 'react';
import { useMenuStore, type MainMenuOptions, type PauseMenuOptions } from '../stores/menuStore.js';
import { SettingsPanel } from './SettingsPanel.js';
import { ControlsGuide } from './ControlsGuide.js';

function PlanetArt() {
  return <div className="planet-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="art-moon" /><div className="art-planet" /><span className="planet-caption">SELA / HOME WORLD<br /><span>A new horizon awaits.</span></span></div>;
}

function MainMenu({ options }: { options: MainMenuOptions }) {
  const [showSettings, setShowSettings] = useState(false);
  return (
    <div id="menu">
      <div className="menu-topline"><span className="brand-mark">◈ <span>CORELIGHT</span></span><span>EXPLORATION PROGRAM</span></div>
      <div className="menu-shell">
        <section className="menu-copy">
          <div className="eyebrow">A LITTLE FURTHER INTO THE UNKNOWN</div>
          <h1>Corelight<span className="title-dot">.</span></h1>
          <p className="menu-sub">Small planets.<br />Endless possibilities.</p>
          <p className="menu-description">Carve your own path beneath the surface. Build a place to call home. Keep a line back to the light.</p>
          <div className="menu-buttons">
            {options.error ? <div className="menu-error" role="alert">{options.error}</div> : null}
            {options.hasSave ? <button type="button" className="menu-button primary" onClick={options.onContinue}>Continue expedition <span>↗</span></button> : null}
            <button type="button" className={`menu-button${options.hasSave ? '' : ' primary'}`} onClick={options.onNewGame}>{options.hasSave ? 'New game' : 'Begin expedition'} <span>→</span></button>
            {options.hasSave ? <div className="menu-note">A new game replaces your current save after confirmation.</div> : null}
            <button type="button" className="menu-button" aria-expanded={showSettings} onClick={() => setShowSettings((s) => !s)}>Settings <span>{showSettings ? '−' : '+'}</span></button>
          </div>
          {showSettings ? <SettingsPanel /> : <ControlsGuide />}
        </section>
        <PlanetArt />
      </div>
      <div className="menu-bottomline"><span>STAY CURIOUS. STAY CONNECTED.</span><span>SINGLE PLAYER · LOCAL SAVE</span></div>
    </div>
  );
}

function PauseMenu({ options }: { options: PauseMenuOptions }) {
  const [saveLabel, setSaveLabel] = useState('Save now');
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(): Promise<void> {
    setBusy(true);
    setSaveLabel('Saving…');
    try { setSaveLabel(await options.onSaveNow() ? 'Saved!' : 'Save failed · retry'); }
    catch { setSaveLabel('Save failed · retry'); }
    finally { setBusy(false); }
  }
  async function quit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const ok = await options.onQuitToMenu();
      if (!ok) setError('Your progress could not be saved. Retry Save now before leaving.');
    } catch { setError('Could not leave the expedition. Please retry.'); }
    finally { setBusy(false); }
  }
  return (
    <div id="pause-menu">
      <div className="pause-shell">
        <section>
          <div className="eyebrow">EXPEDITION ON HOLD</div>
          <h1>Take a breath<span className="title-dot">.</span></h1>
          <p className="menu-sub">Your next discovery can wait.</p>
          <div className="menu-buttons">
            <button type="button" className="menu-button primary" disabled={busy} onClick={options.onResume}>Resume <kbd>Esc</kbd></button>
            <button type="button" className="menu-button" disabled={busy} onClick={() => { void save(); }}>{saveLabel} <span>↓</span></button>
            <button type="button" className="menu-button" aria-expanded={showSettings} onClick={() => setShowSettings((s) => !s)}>Settings <span>{showSettings ? '−' : '+'}</span></button>
            <button type="button" className="menu-button quiet" disabled={busy} onClick={() => { void quit(); }}>Save & quit to menu <span>↗</span></button>
            {error ? <div className="menu-error" role="alert">{error}</div> : null}
          </div>
        </section>
        <section className="pause-details">{showSettings ? <SettingsPanel /> : <><div className="eyebrow">PREPARE FOR THE NEXT STEP</div><h2>Follow your curiosity.<br />Bring your oxygen.</h2><p>Build tethers as you explore. A connected line is the difference between a discovery and a rescue.</p><ControlsGuide /></>}</section>
      </div>
    </div>
  );
}

export function MenuViews() {
  const view = useMenuStore((s) => s.view);
  if (view.kind === 'main') return <MainMenu options={view.options} />;
  if (view.kind === 'pause') return <PauseMenu options={view.options} />;
  return null;
}
