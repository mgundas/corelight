import { DEFAULT_SEED } from './core/constants.js';
import { getUrlParams } from './core/urlParams.js';
import { PLANETS } from './planets/solarSystem.js';
import { runBoot } from './game/boot.js';
import { Game } from './game/Game.js';
import './main.css';

async function boot(): Promise<void> {
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
    'Corelight M02 — streaming octree LOD, drag/click to look, WASD fly, Q/E down/up, wheel = speed, F1 overlay, F3 toggle fly, F4 wireframe, F5 chunk bounds';
  app.appendChild(hint);

  const { prebuilt } = await runBoot(seed, PLANETS, params.skipBoot);
  const game = new Game(canvas, seed, PLANETS, prebuilt);
  game.start();
}

void boot();
