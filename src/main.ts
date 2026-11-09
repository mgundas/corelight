import { getUrlParams } from './core/urlParams.js';
import { Game } from './game/Game.js';
import './main.css';

const DEFAULT_SEED = 1337;

function boot(): void {
  const params = getUrlParams();
  const seed = params.seed ?? DEFAULT_SEED;

  const app = document.getElementById('app');
  if (!app) throw new Error('#app element missing');

  const canvas = document.createElement('canvas');
  canvas.id = 'scene';
  app.appendChild(canvas);

  const hint = document.createElement('div');
  hint.id = 'hint';
  hint.textContent = 'Corelight M00 — drag or click to look, WASD fly, Q/E down/up, wheel = speed, F1 overlay, F3 toggle fly';
  app.appendChild(hint);

  const game = new Game(canvas, seed);
  // skipBoot exists for later milestones (pre-generation); accepted here.
  void params.skipBoot;
  game.start();
}

boot();
