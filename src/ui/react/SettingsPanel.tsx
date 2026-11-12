import { useState, useSyncExternalStore } from 'react';
import { DEFAULT_SETTINGS, getSettings, SETTING_LIMITS, subscribeSettings, updateSettings, type Settings } from '../../core/settings.js';

export function SettingsPanel() {
  const settings = useSyncExternalStore(subscribeSettings, getSettings);
  const [saved, setSaved] = useState(true);
  function change(patch: Partial<Settings>): void { setSaved(updateSettings(patch)); }
  return (
    <div className="settings-panel" aria-label="Settings">
      <div className="eyebrow">CAMERA & DISPLAY</div>
      <label className="setting-row" htmlFor="sensitivity">Mouse sensitivity <output>{settings.sensitivity.toFixed(2)}×</output></label>
      <input id="sensitivity" type="range" {...SETTING_LIMITS.sensitivity} value={settings.sensitivity} onChange={(e) => change({ sensitivity: Number(e.target.value) })} />
      <label className="setting-row" htmlFor="fov">Field of view <output>{settings.fov}°</output></label>
      <input id="fov" type="range" {...SETTING_LIMITS.fov} value={settings.fov} onChange={(e) => change({ fov: Number(e.target.value) })} />
      <label className="setting-row">Invert vertical look<input type="checkbox" checked={settings.invertY} onChange={(e) => change({ invertY: e.target.checked })} /></label>
      <label className="setting-row">Smooth camera recovery<input type="checkbox" checked={settings.smoothCamera} onChange={(e) => change({ smoothCamera: e.target.checked })} /></label>
      <label className="setting-row">Shadows<select value={settings.shadows} onChange={(e) => {
        const value = e.target.value;
        if (value === 'off' || value === 'low' || value === 'high') change({ shadows: value });
      }}><option value="off">Off</option><option value="low">Low</option><option value="high">High</option></select></label>
      <div className="settings-footer"><span>{saved ? 'Changes save automatically' : 'Storage unavailable · applied for this session'}</span><button type="button" onClick={() => change(DEFAULT_SETTINGS)}>Reset</button></div>
    </div>
  );
}
