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
import { computeToolAim as buildToolAim } from './aimWiring.js';
import { FreeFlyCamera } from '../player/freeFlyCamera.js';
import { PlayerInput } from '../player/input.js';
import { TerrainTool, type ToolAim } from '../player/terrainTool.js';
import { World } from '../sim/world.js';
import type { EntityId } from '../sim/entities.js';
import { findFollowed } from './environment.js';
import { disposePhysics } from '../sim/physics/rapierWorld.js';
import { TerrainColliders } from '../sim/physics/terrainColliders.js';
import { serializeWorld, type SaveData } from '../save/serialize.js';
import { DebugOverlay } from '../ui/debugOverlay.js';
import { Hud } from '../ui/hud.js';
import { updateFrameHud, updatePlacementGhost, updateToolPreview } from './frameHud.js';
import { installDebugHandle, uninstallDebugHandle } from './debugHandle.js';
import { setupWorldSystems } from './worldSetup.js';
import { updateDebugOverlay } from './debugStats.js';
import { PlacementMode } from './placement.js';
import { CableMode } from './cableMode.js';
import { PackHold } from './packHold.js';
import { dispatchTickInput } from './tickInput.js';
import { createPrinterUi, updatePrinterUi } from './printerWiring.js';
import type { PrinterUi } from '../ui/printerUi.js';
import { updateCameraAndEnvironment } from './frameCamera.js';

// Game owns World + Renderer and wires the fixed-timestep loop: sim runs at
// 30 Hz, rendering interpolates, and input becomes Actions per tick.

export class Game {
  readonly world: World;
  readonly renderer: Renderer;
  readonly flyCamera = new FreeFlyCamera();
  readonly rig = new CameraRig();
  readonly input = new PlayerInput();
  readonly tool = new TerrainTool();
  readonly overlay = new DebugOverlay();
  readonly placement = new PlacementMode();
  readonly cable = new CableMode();
  readonly packHold = new PackHold();
  private readonly hud = new Hud();
  private readonly printerUi: PrinterUi;

  private playerId: EntityId | null = null;
  private readonly colliders: TerrainColliders;
  private readonly colliderPool = new ColliderPool();
  /** Edited-density fields for the tool fallback raymarch + surface normals. */
  private readonly toolFields = new Map<string, DensityField>();
  /** Aim from the last computeToolAim (drives stroke dispatch + preview). */
  private toolAim: ToolAim = { hit: null, normal: null, planet: null };

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
  private wireframe = false;
  /** Pause menu state: ticks stop, rendering continues behind the menu. */
  private paused = false;
  private readonly planets: PlanetConfig[];
  private readonly unsubscribeOriginShifted: () => void;
  private readonly unsubscribeTerrainEdited: () => void;
  private readonly unsubscribePlayerDied: () => void;

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
      // acceptance (solar/battery recipes are M11-gated). Continue keeps the
      // stored backpack instead.
      devTethers: !existingWorld && getUrlParams().dev,
      devBuild: !existingWorld && getUrlParams().build,
    });
    this.colliders = setup.colliders;
    this.playerId = setup.playerId;
    this.printerUi = createPrinterUi(this.world, () => this.playerId);

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

    window.addEventListener('keydown', this.handleGlobalKey);
    this.unsubscribeOriginShifted = events.on('originShifted', () => {
      this.originShifts += 1;
    });
    // Oxygen death: fade to black as the sim respawns at the habitat.
    this.unsubscribePlayerDied = events.on('playerDied', ({ playerId }) => {
      if (playerId === this.playerId) this.hud.showDeathFade();
    });
    // Console debug handle: lets a blank screen be diagnosed with facts
    // (entity positions) instead of theories. Read-only, browser only.
    installDebugHandle(this.world, () => this.playerId, {
      flying: () => this.flyCamera.enabled,
      views: () => ({
        tethers: this.renderer.tetherViews.group,
        cables: this.renderer.cableViews.group,
        habitats: this.renderer.habitatViews.group,
        markers: this.renderer.markerViews.group,
        placeables: this.renderer.placeableViews.group,
      }),
    });
  }

  private handleGlobalKey = (e: KeyboardEvent): void => {
    if (e.code === 'F1') {
      e.preventDefault();
      this.overlay.toggle();
    } else if (e.code === 'F3') {
      e.preventDefault();
      this.toggleFly();
    } else if (e.code === 'F4') {
      e.preventDefault();
      this.wireframe = !this.wireframe;
      this.renderer.setWireframe(this.wireframe);
    } else if (e.code === 'F5') {
      e.preventDefault();
      this.renderer.setBoundsVisible(!this.renderer.bounds.isVisible());
    }
  };

  /** Aim the tool from the orbit camera; strokes bake it into Actions. */
  private computeToolAim(alpha: number, detailed: boolean): void {
    const followed = findFollowed(this.world, this.planets, this.playerId);
    this.toolAim = buildToolAim({
      followed,
      field: followed ? this.toolFields.get(followed.planet.id) : undefined,
      renderPos:
        this.flyCamera.enabled || !followed
          ? null
          : (this.renderer.playerView.interpolatedWorld(alpha) ?? followed.position),
      rigPosition: this.rig.position,
      castRay: (origin, rayDir, maxDist) =>
        this.colliders.castTerrainRay(origin, rayDir, this.planets, maxDist),
      detailed,
    });
  }

  /** F3: free-fly debug camera. Leaving it drops the player at the camera. */
  private toggleFly(): void {
    this.flyCamera.enabled = !this.flyCamera.enabled;
    this.packHold.reset();
    this.cable.cancel();
    const player = this.playerId ? this.world.entities.get(this.playerId) : undefined;
    if (this.flyCamera.enabled) {
      if (player) this.flyCamera.position = { ...player.position };
      this.input.setEnabled(false);
      this.printerUi.close();
    } else {
      this.input.setEnabled(true);
      if (player && this.playerId) {
        this.world.dispatch({ type: 'playerTeleport', playerId: this.playerId, position: { ...this.flyCamera.position } });
      }
    }
  }
  /** Freeze sim ticks (pause menu); rendering continues behind the menu. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    // Edges queued while paused must never fire on resume (e.g. Q dropping
    // a slot): disabling clears every queue, and re-enabling on resume
    // drains anything queued by the menu itself (including the L bypass).
    if (paused) {
      this.input.setEnabled(false);
      this.packHold.reset();
      this.cable.cancel();
      this.printerUi.close();
    } else {
      this.input.setEnabled(!this.flyCamera.enabled);
    }
  }

  isPaused(): boolean {
    return this.paused;
  }
  /** Current world as a save payload (autosave / Save now). */
  snapshot(): SaveData {
    return serializeWorld(this.world);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (now: number): void => {
      if (!this.running) return;
      this.frame(now);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('keydown', this.handleGlobalKey);
    this.unsubscribeOriginShifted();
    this.unsubscribeTerrainEdited();
    this.flyCamera.detach();
    this.input.detach();
    this.unsubscribePlayerDied();
    this.printerUi.dispose();
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
    // only runs while a brush button is actually held.
    const toolButtons = this.input.toolButtons();
    const toolActive = toolButtons.dig || toolButtons.add || toolButtons.flatten;
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
          toolAim: this.toolAim,
          toolButtons,
          toolActive,
          nowMs: performance.now(),
          flying,
          uiOpen: this.printerUi.isOpen(),
          placement: this.placement,
          cable: this.cable,
          packHold: this.packHold,
          openStation: (stationId) => this.printerUi.openStation(stationId),
          togglePrinter: () => {
            if (this.printerUi.isOpen()) this.printerUi.close();
            else if (!this.flyCamera.enabled) this.printerUi.openBackpack();
          },
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
    updatePrinterUi(this.world, this.playerId, this.printerUi);
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
    // fly mode or when nothing is in range). Re-set every frame from world
    // doubles, so origin shifts can never desync it.
    updateToolPreview({ renderer: this.renderer, flying, hit: this.toolAim.hit, radius: this.tool.radius });
    this.renderer.render();

    // Debug overlay content. The overlay no-ops while hidden, so skip the
    // stats work (mesh counts, layer lookup) entirely in that case.
    if (this.overlay.isVisible()) {
      updateDebugOverlay({
        world: this.world,
        planets: this.planets,
        renderer: this.renderer,
        overlay: this.overlay,
        colliders: this.colliders,
        playerId: this.playerId,
        toolAim: this.toolAim,
        toolRadius: this.tool.radius,
        fps: this.fps,
        tickMs: this.lastTickMs,
        flySpeed: this.flySpeed,
        originShifts: this.originShifts,
        activePos,
        depthBelowM,
      });
    }
  }
}
