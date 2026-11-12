import { MAX_TICKS_PER_FRAME, SIM_DT } from '../core/constants.js';
import { events } from '../core/events.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { PLANETS } from '../planets/solarSystem.js';
import { type DensityField } from '../terrain/density.js';
import { ColliderPool } from '../terrain/colliderPool.js';
import { getUrlParams } from '../core/urlParams.js';
import { Renderer, type PrebuiltTerrain } from '../render/Renderer.js';
import { CameraRig } from '../player/cameraRig.js';
import { wireTerrainEdits } from './editWiring.js';
import { computeFrameAim } from './frameAim.js';
import { FreeFlyCamera } from '../player/freeFlyCamera.js';
import { PlayerInput } from '../player/input.js';
import { TerrainTool, type ToolAim } from '../player/terrainTool.js';
import { ToolMode } from './toolMode.js';
import type { WorldRay } from './grabPick.js';
import { installUiCommands } from './uiCommands.js';
import { resetUiCommands } from '../ui/stores/commandsStore.js';
import { resetDragStore } from '../ui/stores/dragStore.js';
import { installGameDebugKeys } from './debugWiring.js';
import { toggleFly } from './flyToggle.js';
import { World } from '../sim/world.js';
import type { EntityId } from '../sim/entities.js';
import { disposePhysics } from '../sim/physics/rapierWorld.js';
import { TerrainColliders } from '../sim/physics/terrainColliders.js';
import { serializeWorld, type SaveData } from '../save/serialize.js';
import { DebugOverlay } from '../ui/debugOverlay.js';
import { Hud } from '../ui/hud.js';
import { updateFrameHud, updatePlacementGhost, updateToolPreview } from './frameHud.js';
import { installGameDebugHandle, uninstallDebugHandle } from './debugHandle.js';
import { setupWorldSystems } from './worldSetup.js';
import { updateFrameDebug } from './frameDebug.js';
import { PlacementMode } from './placement.js';
import { CableMode } from './cableMode.js';
import { PackHold } from './packHold.js';
import { dispatchTickInput } from './tickInput.js';
import { StationUi } from './stationUi.js';
import { updateCameraAndEnvironment } from './frameCamera.js';
import { applyPaused } from './pause.js';

// Game owns World + Renderer and wires the fixed-timestep loop: sim runs at
// 30 Hz, rendering interpolates, and input becomes Actions per tick.

export class Game {
  readonly world: World;
  readonly renderer: Renderer;
  readonly flyCamera = new FreeFlyCamera();
  readonly rig = new CameraRig();
  readonly input = new PlayerInput();
  readonly tool = new TerrainTool();
  readonly toolMode = new ToolMode();
  readonly overlay = new DebugOverlay();
  readonly placement = new PlacementMode();
  readonly cable = new CableMode();
  readonly packHold = new PackHold();
  private readonly hud = new Hud();
  private readonly stationUi: StationUi;

  private playerId: EntityId | null = null;
  private readonly colliders: TerrainColliders;
  private readonly colliderPool = new ColliderPool();
  /** Edited-density fields for the tool fallback raymarch + surface normals. */
  private readonly toolFields = new Map<string, DensityField>();
  /** Aim from the last computeToolAim (drives stroke dispatch + preview). */
  private toolAim: ToolAim = { hit: null, normal: null, planet: null };
  /** Screen ray under the cursor (cursor mode grab picking), null in fly. */
  private cursorRay: WorldRay | null = null;
  /** Loose item hovered by the cursor (prompt + click-to-grab), else null. */
  private cursorItemId: EntityId | null = null;
  /** Empty structure hovered by the cursor (prompt + click-to-move). */
  private cursorPackId: EntityId | null = null;

  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private lastTickMs = 0;
  private originShifts = 0;
  private flySpeed = 60;
  /** Pause menu state: ticks stop, rendering continues behind the menu. */
  private paused = false;
  private readonly planets: PlanetConfig[];
  private readonly unsubscribeOriginShifted: () => void;
  private readonly unsubscribeTerrainEdited: () => void;
  private readonly unsubscribePlayerDied: () => void;
  private readonly disposeDebugKeys: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    seed: number,
    planets: PlanetConfig[] = PLANETS,
    prebuilt: PrebuiltTerrain[] = [],
    initialTimeS = 0,
    /** Restored world for the Continue path (edits/entities/clock intact). */
    existingWorld?: World,
  ) {
    this.planets = planets;
    if (existingWorld) {
      // Continue: the world must reach the streamer before the first frame
      // so edited ground never flashes; seeding/spawning is skipped.
      this.world = existingWorld;
    } else {
      // Fresh setup goes through the constructor (hard rule 2: no direct
      // World field assignment), only dispatch() + systems after this.
      this.world = new World(seed, { planets, time: initialTimeS });
    }

    // Physics, items, node streaming and sun (see worldSetup for the tick
    // order); then the spawn so the very first tick already
    // freezes/requests correctly. All seeds derive from the world (a
    // restored save brings its own), never from boot/URL params.
    const worldSeed = this.world.seed;
    const setup = setupWorldSystems(this.world, planets, this.colliderPool, seed, existingWorld, {
      // Dev shortcuts: ?dev=1 starts with a full tether pack for oxygen
      // testing; ?build=1 starts with power-base packages for the M10
      // acceptance (solar/battery are research-gated since M11; the dev grant
      // deliberately bypasses the tree). Continue keeps the stored backpack.
      devTethers: !existingWorld && getUrlParams().dev,
      devBuild: !existingWorld && getUrlParams().build,
    });
    this.colliders = setup.colliders;
    this.playerId = setup.playerId;
    this.stationUi = new StationUi(this.world, this.hud);
    installUiCommands(
      this.world,
      () => this.playerId,
      () => this.stationUi.closePrinter(),
      () => this.stationUi.closeResearch(),
    );

    this.renderer = new Renderer(canvas, worldSeed, planets, prebuilt);
    const wiring = wireTerrainEdits(this.world, planets, this.colliders, this.renderer.streamer);
    this.toolFields = wiring.toolFields;
    // The habitat pad is flattened during setup (after the seed-dependent
    // boot prebuilt was baked): push its chunks through the priority remesh
    // and the collider ring so the pad never flashes unflattened.
    if (setup.editedKeys.length > 0) {
      this.colliders.notifyEdited(setup.editedKeys);
      this.renderer.streamer.notifyEdited(setup.editedKeys);
    }
    this.unsubscribeTerrainEdited = wiring.dispose;
    this.flyCamera.speed = 60;
    this.flyCamera.enabled = false;
    this.flyCamera.attach(canvas, (speed) => {
      this.flySpeed = speed;
    });
    this.flySpeed = this.flyCamera.speed;
    this.input.attach(canvas, this.rig, this.rig, this.tool);
    this.input.setEnabled(true);

    this.disposeDebugKeys = installGameDebugKeys({
      world: this.world,
      planets: this.planets,
      playerId: () => this.playerId,
      overlay: this.overlay,
      renderer: this.renderer,
      toggleFly: () => this.toggleFly(),
    });
    this.unsubscribeOriginShifted = events.on('originShifted', () => {
      this.originShifts += 1;
    });
    // Oxygen death: fade to black as the sim respawns at the habitat.
    this.unsubscribePlayerDied = events.on('playerDied', ({ playerId }) => {
      if (playerId === this.playerId) this.hud.showDeathFade();
    });
    // Console debug handle: lets a blank screen be diagnosed with facts
    // (entity positions) instead of theories. Read-only, browser only.
    installGameDebugHandle(this.world, () => this.playerId, this.renderer, () => this.flyCamera.enabled);
  }

  /** Aim the tool from the cursor (or screen center while orbiting). */
  private computeToolAim(alpha: number, detailed: boolean): void {
    const result = computeFrameAim({
      world: this.world,
      planets: this.planets,
      playerId: this.playerId,
      renderer: this.renderer,
      colliders: this.colliders,
      toolFields: this.toolFields,
      flyCamera: this.flyCamera,
      rig: this.rig,
      alpha,
      detailed,
      toolActive: this.toolMode.active,
      orbiting: this.input.isOrbiting(),
      cursorX: this.input.cursorX,
      cursorY: this.input.cursorY,
    });
    this.toolAim = result.aim;
    this.cursorRay = result.ray;
    this.cursorItemId = result.hoverItemId;
    this.cursorPackId = result.hoverPackId;
  }

  /** F3: free-fly debug camera. Leaving it drops the player at the camera. */
  private toggleFly(): void {
    toggleFly({
      world: this.world,
      playerId: this.playerId,
      flyCamera: this.flyCamera,
      input: this.input,
      cable: this.cable,
      packHold: this.packHold,
      closeAllUi: () => this.stationUi.closeAll(),
    });
  }
  /** Freeze sim ticks (pause menu); rendering continues behind the menu. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    applyPaused(
      {
        input: this.input,
        packHold: this.packHold,
        cable: this.cable,
        closeAllUi: () => this.stationUi.closeAll(),
        flyCamera: this.flyCamera,
      },
      paused,
    );
  }

  isPaused(): boolean { return this.paused; }
  /** Current world as a save payload (autosave / Save now). */
  snapshot(): SaveData { return serializeWorld(this.world); }
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (now: number): void => { if (!this.running) return; this.frame(now); this.rafId = requestAnimationFrame(loop); };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.disposeDebugKeys();
    this.unsubscribeOriginShifted();
    this.unsubscribeTerrainEdited();
    this.flyCamera.detach();
    this.input.detach();
    this.unsubscribePlayerDied();
    this.stationUi.dispose();
    resetUiCommands();
    resetDragStore();
    this.colliderPool.dispose();
    this.colliders.dispose();
    disposePhysics();
    this.overlay.dispose();
    this.hud.dispose();
    this.renderer.dispose();
    uninstallDebugHandle();
  }

  private frame(now: number): void {
    let frameDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameDt > 0.25) frameDt = 0.25;

    // FPS counter.
    this.fpsFrames += 1;
    this.fpsTime += frameDt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    // Fixed-timestep sim (cap catch-up so a hitch can't spiral).
    // Movement input is sampled per tick so replays stay deterministic.
    // The tool aim is frame-rate (render state); strokes bake it into Actions.
    // Buttons are sampled once per frame: detailed aim (march + normal)
    // only runs while the tool/placement is actually active.
    const toolButtons = this.input.toolButtons();
    const toolActive = this.toolMode.active;
    this.computeToolAim(
      Math.min(1, Math.max(0, this.accumulator / SIM_DT)),
      toolActive || this.placement.isActive(),
    );
    const flying = this.flyCamera.enabled;
    if (!this.paused) {
      this.accumulator += frameDt;
      let ticks = 0;
      while (this.accumulator >= SIM_DT && ticks < MAX_TICKS_PER_FRAME) {
        // All input queues drain per tick (headlamp works in fly mode too);
        // dispatchTickInput owns the E/Tab/placement/tool priority chain.
        dispatchTickInput({
          world: this.world,
          playerId: this.playerId,
          input: this.input,
          rig: this.rig,
          tool: this.tool,
          toolMode: this.toolMode,
          toolAim: this.toolAim,
          cursorRay: this.cursorRay,
          toolButtons,
          nowMs: performance.now(),
          flying,
          uiOpen: this.stationUi.isOpen(),
          placement: this.placement,
          cable: this.cable,
          packHold: this.packHold,
          openStation: (stationId) => this.stationUi.openStation(stationId),
          openResearch: (stationId) => this.stationUi.openResearch(stationId),
          togglePrinter: () => this.stationUi.togglePrinter(!this.flyCamera.enabled),
        });
        const t0 = performance.now();
        this.world.tick(SIM_DT);
        this.lastTickMs = performance.now() - t0;
        this.accumulator -= SIM_DT;
        ticks += 1;
        const player = this.playerId ? this.world.entities.get(this.playerId) : undefined;
        if (player) this.renderer.pushPlayerSample(player.position, player.rotation);
      }
      if (ticks === MAX_TICKS_PER_FRAME) {
        this.accumulator = 0;
      }
    }

    // Active camera + day/night environment (frameCamera.ts): fly cam in F3
    // mode, orbit rig otherwise; origin shifts and lighting follow whichever
    // the player sees through.
    const alpha = this.accumulator / SIM_DT;
    const { activePos, focusWorld, depthBelowM } = updateCameraAndEnvironment({
      world: this.world,
      planets: this.planets,
      renderer: this.renderer,
      rig: this.rig,
      colliders: this.colliders,
      flyCamera: this.flyCamera,
      playerId: this.playerId,
      flying,
      paused: this.paused,
      frameDt,
      alpha,
    });

    // LOD streaming around the active camera (priority queue + 4 ms apply
    // budget). Chunk meshes are positioned when added and re-synced on
    // origin shifts only.
    this.renderer.updateStreaming(activePos);
    this.renderer.renderPlayer(alpha);
    this.stationUi.update(this.playerId);
    updateFrameHud({
      renderer: this.renderer,
      hud: this.hud,
      world: this.world,
      playerId: this.playerId,
      flying,
      focusWorld,
      aim: this.toolAim,
      placement: this.placement,
      cable: this.cable,
      toolMode: this.toolMode,
      cursorItemId: this.cursorItemId,
      cursorPackId: this.cursorPackId,
    });
    updatePlacementGhost({
      renderer: this.renderer,
      world: this.world,
      playerId: this.playerId,
      flying,
      aim: this.toolAim,
      placement: this.placement,
    });
    // Terrain brush preview: translucent sphere at the aim point (hidden in
    // fly mode, with the tool stowed, or when nothing is in range). Re-set
    // every frame from world doubles, so origin shifts can never desync it.
    updateToolPreview({
      renderer: this.renderer,
      flying: flying || !this.toolMode.active,
      hit: this.toolAim.hit,
      radius: this.tool.radius,
    });
    this.renderer.render();

    // Debug overlay content (stats work is skipped while hidden).
    updateFrameDebug({
      world: this.world,
      planets: this.planets,
      renderer: this.renderer,
      overlay: this.overlay,
      colliders: this.colliders,
      playerId: this.playerId,
      toolAim: this.toolAim,
      toolRadius: this.tool.radius,
      toolMode: this.toolMode.active ? 'deform' : 'cursor',
      brushMode: this.toolMode.brush,
      fps: this.fps,
      tickMs: this.lastTickMs,
      flySpeed: this.flySpeed,
      originShifts: this.originShifts,
      activePos,
      depthBelowM,
    });
  }
}
