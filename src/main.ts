import { DEFAULT_SEED, DAY_LENGTH_S } from './core/constants.js';
import { getUrlParams } from './core/urlParams.js';
import { PLANETS } from './planets/solarSystem.js';
import { runBoot } from './game/boot.js';
import { Game } from './game/Game.js';
import type { PrebuiltTerrain } from './render/Renderer.js';
import { initPhysics } from './sim/physics/rapierWorld.js';
import type { World } from './sim/world.js';
import { deserializeWorld } from './save/serialize.js';
import { clearSave, hasSave, loadSave, startAutosave, storeSave } from './save/storage.js';
import { showMainMenu, showPauseMenu } from './ui/menu.js';
import './main.css';

/** One live session: game + autosave + pause wiring, all disposed on quit. */
interface Session {
  game: Game;
  stopAutosave: () => void;
  disposePauseKey: () => void;
  disposePauseMenu: () => void;
}

function launchSession(
  canvas: HTMLCanvasElement,
  opts: { seed: number; initialTimeS?: number; existingWorld?: World },
): Session {
  const seed = opts.existingWorld ? opts.existingWorld.seed : opts.seed;
  const game = new Game(canvas, seed, PLANETS, currentPrebuilt(seed), opts.initialTimeS ?? 0, opts.existingWorld);
  game.start();
  const stopAutosave = startAutosave(() => game.snapshot());
  let disposePauseMenu: () => void = () => undefined;
  const closePauseMenu = (): void => {
    disposePauseMenu();
    disposePauseMenu = () => undefined;
    game.setPaused(false);
  };
  const onKey = (e: KeyboardEvent): void => {
    // Esc while pointer-locked exits the lock instead of reaching the page;
    // a second press (unlocked) opens the menu. Documented in the hint bar.
    if (e.code !== 'Escape') return;
    if (game.isPaused()) {
      closePauseMenu();
    } else {
      game.setPaused(true);
      disposePauseMenu = showPauseMenu({
        onResume: closePauseMenu,
        onSaveNow: () => storeSave(game.snapshot()),
        onQuitToMenu: () => {
          // Quit must not lose up to 60 s of progress: persist before the
          // session (and its autosave) is torn down.
          void (async () => {
            await storeSave(game.snapshot());
            closePauseMenu();
            stopSession();
            await showMenu();
          })();
        },
      });
    }
  };
  window.addEventListener('keydown', onKey);
  return {
    game,
    stopAutosave,
    disposePauseKey: () => {
      window.removeEventListener('keydown', onKey);
    },
    disposePauseMenu: closePauseMenu,
  };
}

let activeSession: Session | null = null;
let bootPrebuilt: PrebuiltTerrain[] = [];
let bootSeed = DEFAULT_SEED;
let appCanvas: HTMLCanvasElement | null = null;

/** Coarse prebuilt meshes are seed-dependent: reuse them only on a match. */
function currentPrebuilt(seed: number): PrebuiltTerrain[] {
  return seed === bootSeed ? bootPrebuilt : [];
}

function stopSession(): void {
  if (!activeSession) return;
  const session = activeSession;
  activeSession = null;
  session.disposePauseMenu();
  session.disposePauseKey();
  session.stopAutosave();
  session.game.stop();
}

async function showMenu(error: string | null = null): Promise<void> {
  const canvas = appCanvas;
  if (!canvas) throw new Error('canvas missing');
  const saveExists = await hasSave();
  const dispose = showMainMenu({
    hasSave: saveExists,
    error,
    onContinue: () => {
      void (async () => {
        dispose();
        const raw = await loadSave();
        if (!raw) {
          await showMenu('No save found.');
          return;
        }
        let world: World;
        try {
          world = deserializeWorld(raw, PLANETS);
        } catch (err) {
          console.error('save is corrupt', err);
          await showMenu('That save is corrupt and could not be loaded.');
          return;
        }
        // The URL seed only applies to fresh games; a save brings its own.
        activeSession = launchSession(canvas, { seed: world.seed, existingWorld: world });
      })();
    },
    onNewGame: () => {
      void (async () => {
        if (saveExists && !window.confirm('Start a new game? Your saved game will be overwritten.')) {
          return;
        }
        dispose();
        await clearSave();
        const params = getUrlParams();
        // ?time= starts the clock mid-cycle; the sun system derives light
        // from it. (Continue restores the stored clock instead.)
        const initialTimeS = (params.time ?? 0) * DAY_LENGTH_S;
        activeSession = launchSession(canvas, { seed: params.seed ?? DEFAULT_SEED, initialTimeS });
      })();
    },
  });
}

async function boot(): Promise<void> {
  // Rapier wasm must be ready before the game (and its physics system) starts.
  await initPhysics();
  const params = getUrlParams();
  bootSeed = params.seed ?? DEFAULT_SEED;

  const app = document.getElementById('app');
  if (!app) throw new Error('#app element missing');

  const canvas = document.createElement('canvas');
  canvas.id = 'scene';
  app.appendChild(canvas);
  appCanvas = canvas;

  const hint = document.createElement('div');
  hint.id = 'hint';
  hint.textContent =
    'Corelight M09 — walk with WASD, mouse look (click), Space jump, Shift sprint, wheel zoom, LMB dig, RMB add, F flatten, Ctrl+wheel brush size, E interact (pick up / tether / station / place), Tab printer, Q drop, 1-8 slots, T tether, L headlamp, Esc menu, F1 overlay, F3 fly, F4 wireframe, F5 chunk bounds';
  app.appendChild(hint);

  const { prebuilt } = await runBootSafe(bootSeed, params.skipBoot);
  bootPrebuilt = prebuilt;
  await showMenu();
}

/** Boot pre-generation must never black-screen the game: on failure the
 * live streamer meshes everything a moment later. */
async function runBootSafe(seed: number, skipBoot: boolean): Promise<{ prebuilt: PrebuiltTerrain[] }> {
  try {
    const { prebuilt } = await runBoot(seed, PLANETS, skipBoot);
    return { prebuilt };
  } catch (err) {
    console.error('boot pre-generation failed, streaming live instead', err);
    return { prebuilt: PLANETS.map((planet) => ({ planet, results: [], emptyKeys: [] })) };
  }
}

void boot();
