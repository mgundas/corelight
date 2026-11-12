// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, getSettings, SETTINGS_KEY, subscribeSettings, updateSettings, validateSettings } from '../../src/core/settings.js';

beforeEach(() => { localStorage.clear(); updateSettings(DEFAULT_SETTINGS); });
afterEach(() => { vi.restoreAllMocks(); });

describe('presentation settings', () => {
  it('rejects malformed values and clamps numeric ranges', () => {
    expect(validateSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings({ sensitivity: Infinity, fov: Number.NaN, invertY: 'true', shadows: 'ultra' })).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings({ sensitivity: -1, fov: 200 })).toMatchObject({ sensitivity: 0.25, fov: 90 });
  });

  it('persists preferences and restores them on a fresh module load', async () => {
    updateSettings({ fov: 82, sensitivity: 1.4, invertY: true, shadows: 'low' });
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')).toMatchObject({ fov: 82, invertY: true, shadows: 'low' });
    vi.resetModules();
    const restored = await import('../../src/core/settings.js');
    expect(restored.getSettings()).toMatchObject({ fov: 82, sensitivity: 1.4, invertY: true, shadows: 'low' });
  });

  it('survives corrupt JSON and unavailable storage during startup', async () => {
    localStorage.setItem(SETTINGS_KEY, '{broken');
    vi.resetModules();
    expect((await import('../../src/core/settings.js')).getSettings()).toEqual(DEFAULT_SETTINGS);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.resetModules();
    expect((await import('../../src/core/settings.js')).getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('applies session preferences and reports when saving fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(updateSettings({ fov: 80 })).toBe(false);
    expect(getSettings().fov).toBe(80);
  });

  it('releases live subscribers when a renderer or panel is disposed', () => {
    const notify = vi.fn();
    const unsubscribe = subscribeSettings(notify);
    updateSettings({ shadows: 'off' });
    expect(notify).toHaveBeenCalledTimes(1);
    unsubscribe();
    updateSettings({ shadows: 'high' });
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
