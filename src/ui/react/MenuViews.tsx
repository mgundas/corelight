// Main + pause menus (React port). Pure presentation: every button calls a
// callback supplied by main.ts, which owns the session.

import { useState } from 'react';
import { useMenuStore, type MainMenuOptions, type PauseMenuOptions } from '../stores/menuStore.js';

function MainMenu({ options }: { options: MainMenuOptions }) {
  const [showSettings, setShowSettings] = useState(false);
  return (
    <div id="menu">
      <h1>Corelight</h1>
      <div className="menu-sub">A small game about digging holes on small planets</div>
      <div className="menu-buttons">
        {options.error ? <div className="menu-error">{options.error}</div> : null}
        {options.hasSave ? (
          <button type="button" className="menu-button" onClick={options.onContinue}>
            Continue
          </button>
        ) : null}
        <button type="button" className="menu-button" onClick={options.onNewGame}>
          {options.hasSave ? 'New game (overwrites save)' : 'New game'}
        </button>
        <button type="button" className="menu-button" onClick={() => setShowSettings((s) => !s)}>
          Settings
        </button>
        {showSettings ? (
          <div className="menu-note">Settings: coming in a later milestone (M16 polish).</div>
        ) : null}
      </div>
    </div>
  );
}

function PauseMenu({ options }: { options: PauseMenuOptions }) {
  const [saveLabel, setSaveLabel] = useState('Save now');
  const [saveDisabled, setSaveDisabled] = useState(false);
  return (
    <div id="pause-menu">
      <h1>Paused</h1>
      <div className="menu-sub">The world is holding its breath</div>
      <div className="menu-buttons">
        <button type="button" className="menu-button" onClick={options.onResume}>
          Resume
        </button>
        <button
          type="button"
          className="menu-button"
          disabled={saveDisabled}
          onClick={() => {
            setSaveDisabled(true);
            setSaveLabel('Saving…');
            void options.onSaveNow().then((ok) => {
              // Honest confirmation: storeSave reports failure instead of swallowing it.
              setSaveLabel(ok ? 'Saved!' : 'Save failed');
              window.setTimeout(() => {
                setSaveDisabled(false);
                setSaveLabel('Save now');
              }, 1200);
            });
          }}
        >
          {saveLabel}
        </button>
        <button type="button" className="menu-button" onClick={options.onQuitToMenu}>
          Quit to menu
        </button>
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
