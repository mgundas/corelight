import * as THREE from 'three';
import { SHADOW_MAP_SIZE, SHADOW_MAP_SIZE_LOW } from '../core/constants.js';
import { getSettings, subscribeSettings } from '../core/settings.js';
import type { LightingRig } from './lighting.js';

/** Bind once per renderer, including the paused settings preview. */
type RenderPreferencesTarget = Pick<THREE.WebGLRenderer, 'toneMapping'> & {
  shadowMap: Pick<THREE.WebGLShadowMap, 'enabled' | 'needsUpdate'>;
};

export function bindRenderPreferences(renderer: RenderPreferencesTarget, camera: THREE.PerspectiveCamera, lighting: LightingRig): () => void {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  let previousShadows: string | null = null;
  const apply = (): void => {
    const settings = getSettings();
    camera.fov = settings.fov;
    camera.updateProjectionMatrix();
    if (settings.shadows !== previousShadows) {
      previousShadows = settings.shadows;
      renderer.shadowMap.enabled = settings.shadows !== 'off';
      const size = settings.shadows === 'low' ? SHADOW_MAP_SIZE_LOW : SHADOW_MAP_SIZE;
      lighting.sun.shadow.mapSize.set(size, size);
      lighting.sun.shadow.map?.dispose();
      lighting.sun.shadow.map = null;
      lighting.sun.shadow.needsUpdate = true;
      renderer.shadowMap.needsUpdate = true;
    }
  };
  apply();
  return subscribeSettings(apply);
}
