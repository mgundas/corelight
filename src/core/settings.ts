/** Presentation preferences stay outside World and never affect saved gameplay. */
export interface Settings {
  sensitivity: number;
  invertY: boolean;
  fov: number;
  smoothCamera: boolean;
  shadows: 'off' | 'low' | 'high';
}

export const SETTINGS_KEY = 'corelight-settings-v1';
export const DEFAULT_SETTINGS: Readonly<Settings> = {
  sensitivity: 1, invertY: false, fov: 70, smoothCamera: true, shadows: 'high',
};
export const SETTING_LIMITS = {
  sensitivity: { min: 0.25, max: 2, step: 0.05 },
  fov: { min: 50, max: 90, step: 1 },
} as const;

function finiteRange(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

export function validateSettings(raw: unknown): Settings {
  const s = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  return {
    sensitivity: finiteRange(s.sensitivity, DEFAULT_SETTINGS.sensitivity, SETTING_LIMITS.sensitivity.min, SETTING_LIMITS.sensitivity.max),
    fov: finiteRange(s.fov, DEFAULT_SETTINGS.fov, SETTING_LIMITS.fov.min, SETTING_LIMITS.fov.max),
    invertY: typeof s.invertY === 'boolean' ? s.invertY : DEFAULT_SETTINGS.invertY,
    smoothCamera: typeof s.smoothCamera === 'boolean' ? s.smoothCamera : DEFAULT_SETTINGS.smoothCamera,
    shadows: s.shadows === 'off' || s.shadows === 'low' || s.shadows === 'high' ? s.shadows : DEFAULT_SETTINGS.shadows,
  };
}

function load(): Settings {
  try { return validateSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as unknown); }
  catch { return { ...DEFAULT_SETTINGS }; }
}

let settings: Readonly<Settings> = load();
const listeners = new Set<() => void>();
export function getSettings(): Readonly<Settings> { return settings; }
export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Returns false when persistence is unavailable; preferences still work this session. */
export function updateSettings(patch: Partial<Settings>): boolean {
  settings = validateSettings({ ...settings, ...patch });
  let persisted = true;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  catch { persisted = false; }
  for (const listener of listeners) listener();
  return persisted;
}
