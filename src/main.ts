import { DEFAULT_SEED } from './core/constants.js';
import { getUrlParams } from './core/urlParams.js';
import { PLANETS } from './planets/solarSystem.js';
import { runBoot } from './game/boot.js';
import { Game } from './game/Game.js';
import type { PrebuiltTerrain } from './render/Renderer.js';
import { initPhysics } from './sim/physics/rapierWorld.js';
import './main.css';

async function boot(): Promise<void> {
  // Rapier wasm must be ready before the game (and its physics system) starts.
  await initPhysics();
  const params = getUrlParams();
  const seed = params.seed ?? DEFAULT_SEED;

  const app = document.getElementById('app');
  if (!app) throw new Error('#app element missing');

  const canvas = document.createElement('canvas');
  canvas.id = 'scene';
  app.appendChild(canvas);

  const hint = document.createElement('div');
  hint.id = 'hint';
  hint.textContent =
    'Corelight M03 — walk with WASD, mouse look (click), Space jump, Shift sprint, wheel zoom, F1 overlay, F3 fly, F4 wireframe, F5 chunk bounds';
  app.appendChild(hint);

  const { prebuilt } = await runBootSafe(seed, params.skipBoot);
  const game = new Game(canvas, seed, PLANETS, prebuilt);
  game.start();
}

/** Boot pre-generation must never black-screen the game: on failure the
 * live streamer meshes everything a moment later. */
async function runBootSafe(seed: number, skipBoot: boolean): Promise<{ prebuilt: PrebuiltTerrain[] }> {
  try {
    return await runBoot(seed, PLANETS, skipBoot);
  } catch (err) {
    console.error('boot pre-generation failed, streaming live instead', err);
    return { prebuilt: PLANETS.map((planet) => ({ planet, results: [], emptyKeys: [] })) };
  }
}

void boot();
