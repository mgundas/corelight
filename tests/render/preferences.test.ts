import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, updateSettings } from '../../src/core/settings.js';
import { SHADOW_MAP_SIZE, SHADOW_MAP_SIZE_LOW } from '../../src/core/constants.js';
import { LightingRig } from '../../src/render/lighting.js';
import { bindRenderPreferences } from '../../src/render/preferences.js';

beforeEach(() => { updateSettings(DEFAULT_SETTINGS); });
afterEach(() => { updateSettings(DEFAULT_SETTINGS); });

describe('live render preferences', () => {
  it('updates an existing camera and releases the previous shadow target when quality changes', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const lighting = new LightingRig(scene, camera);
    const renderer = { toneMapping: THREE.NoToneMapping as THREE.ToneMapping, shadowMap: { enabled: false, needsUpdate: false } };
    const unbind = bindRenderPreferences(renderer, camera, lighting);
    const target = new THREE.WebGLRenderTarget(16, 16);
    const dispose = vi.spyOn(target, 'dispose');
    lighting.sun.shadow.map = target;
    updateSettings({ fov: 80, shadows: 'low' });
    expect(camera.fov).toBe(80);
    expect(lighting.sun.shadow.mapSize.x).toBe(SHADOW_MAP_SIZE_LOW);
    expect(dispose).toHaveBeenCalledOnce();
    expect(lighting.sun.shadow.map).toBeNull();
    updateSettings({ shadows: 'off' });
    expect(renderer.shadowMap.enabled).toBe(false);
    updateSettings({ shadows: 'high' });
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(lighting.sun.shadow.mapSize.x).toBe(SHADOW_MAP_SIZE);
    unbind(); lighting.dispose();
  });

  it('does not update disposed renderers when settings change', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const lighting = new LightingRig(scene, camera);
    const renderer = { toneMapping: THREE.NoToneMapping as THREE.ToneMapping, shadowMap: { enabled: true, needsUpdate: false } };
    const unbind = bindRenderPreferences(renderer, camera, lighting);
    unbind(); lighting.dispose();
    updateSettings({ fov: 90 });
    expect(camera.fov).toBe(DEFAULT_SETTINGS.fov);
  });
});
