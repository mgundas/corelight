import { MAX_TICKS_PER_FRAME, SIM_DT } from '../core/constants.js';
import { events } from '../core/events.js';
import { type Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { PLANETS } from '../planets/solarSystem.js';
import { type DensityField } from '../terrain/density.js';
import { ColliderPool } from '../terrain/colliderPool.js';
import { maybeShiftOrigin, toLocal } from '../render/floatingOrigin.js';
import { Renderer, type PrebuiltTerrain } from '../render/Renderer.js';
import { CameraRig } from '../player/cameraRig.js';
import { wireTerrainEdits } from './editWiring.js';
import { computeToolAim as buildToolAim } from './aimWiring.js';
import { FreeFlyCamera } from '../player/freeFlyCamera.js';
import { PlayerInput } from '../player/input.js';
import { TerrainTool, type ToolAim } from '../player/terrainTool.js';
import { World } from '../sim/world.js';
import type { EntityId } from '../sim/entities.js';
import { computeEnvironment, findFollowed } from './environment.js';
import { upAt } from '../sim/physics/frames.js';
import { disposePhysics } from '../sim/physics/rapierWorld.js';
import { TerrainColliders } from '../sim/physics/terrainColliders.js';
import { serializeWorld, type SaveData } from '../save/serialize.js';
import { DebugOverlay } from '../ui/debugOverlay.js';
import { Hud } from '../ui/hud.js';
import { backpackFrame, tickBackpackInput } from './backpackWiring.js';
import { setupWorldSystems } from './worldSetup.js';
import { updateDebugOverlay } from './debugStats.js';

// Game owns World + Renderer and wires the fixed-timestep loop:
// sim advances at 30 Hz with an accumulator; rendering interpolates
// every animation frame. M03: third-person astronaut by default, F3 for
// the free-fly debug camera; input becomes playerInput Actions per tick.

export class Game {
  readonly world: World;
  readonly renderer: Renderer;
  readonly flyCamera = new FreeFlyCamera();
  readonly rig = new CameraRig();
  readonly input = new PlayerInput();
  readonly tool = new TerrainTool();
  readonly overlay = new DebugOverlay();
  private readonly hud = new Hud();

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
      // Continue path: the world already carries planets, clock, entities
      // and edits. It must reach the streamer before the first frame (the
      // edit source below reads it live) so edited ground never flashes
      // unedited. Seeding/spawning is skipped; the clock stays exact.
      this.world = existingWorld;
    } else {
      // Fresh setup goes through the constructor: no direct World field
      // assignment (hard rule 2), only dispatch() + systems after this.
      this.world = new World(seed, { planets, time: initialTimeS });
    }

    // Physics, items, node streaming and sun (see worldSetup for the tick
    // order); then the spawn so the very first tick already
    // freezes/requests correctly. All seeds derive from the world (a
    // restored save brings its own), never from boot/URL params.
    const worldSeed = this.world.seed;
    const setup = setupWorldSystems(this.world, planets, this.colliderPool, seed, existingWorld);
    this.colliders = setup.colliders;
    this.playerId = setup.playerId;

    this.renderer = new Renderer(canvas, worldSeed, planets, prebuilt);
    const wiring = wireTerrainEdits(this.world, planets, this.colliders, this.renderer.streamer);
    this.toolFields = wiring.toolFields;
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

  /**
   * Aim the terrain tool from the orbit camera through the crosshair.
   * Computed once per frame from render state; strokes bake it into
   * Actions. Detailed (march + normal) only while a brush button is held;
   * idle frames keep the cheap collider ray for the preview.
   */
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
    const player = this.playerId ? this.world.entities.get(this.playerId) : undefined;
    if (this.flyCamera.enabled) {
      if (player) this.flyCamera.position = { ...player.position };
      this.input.setEnabled(false);
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
    this.running = true;    this.lastTime = performance.now();
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
    this.colliderPool.dispose();
    this.colliders.dispose();
    disposePhysics();
    this.overlay.dispose();
    this.hud.dispose();
    this.renderer.dispose();
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
    this.computeToolAim(Math.min(1, Math.max(0, this.accumulator / SIM_DT)), toolActive);
    const flying = this.flyCamera.enabled;
    if (!this.paused) {
      this.accumulator += frameDt;
      let ticks = 0;
      while (this.accumulator >= SIM_DT && ticks < MAX_TICKS_PER_FRAME) {
      // Headlamp toggle is consumed every tick, in fly mode too (the lamp
      // rides the camera): gating it on third-person would swallow presses.
      if (this.input.consumeHeadlampToggle() && this.playerId) {
        this.world.dispatch({ type: 'toggleHeadlamp', playerId: this.playerId });
      }
      if (!flying && this.playerId) {
        const move = this.input.move();
        this.world.dispatch({
          type: 'playerInput',
          playerId: this.playerId,
          move,
          jump: this.input.consumeJump(),
          sprint: this.input.sprint(),
          lookYaw: this.rig.yaw,
          lookPitch: this.rig.pitch,
        });
        // Backpack keys (M07): digits select a slot immediately, Q drops
        // the selected slot, E picks up the aimed item in range.
        tickBackpackInput(this.world, this.playerId, this.input);
        if (toolActive) {
          const edit = this.tool.update(performance.now(), this.playerId, toolButtons, this.toolAim);
          if (edit) this.world.dispatch(edit);
        }
      }
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

    // Active camera: fly cam in F3 mode, orbit rig otherwise (streaming and
    // the origin shift follow whichever the player sees through).
    // The orbit camera and the avatar share one interpolated render
    // transform: driving the camera from raw post-tick sim state while the
    // mesh renders lagged prev/curr samples made them disagree every frame.
    const alpha = this.accumulator / SIM_DT;
    let activePos: Vec3d;
    if (flying) {
      this.flyCamera.update(frameDt);
      activePos = this.flyCamera.position;
      const local = toLocal(activePos);
      this.flyCamera.applyToCamera(this.renderer.camera, local);
    } else {
      const followed = findFollowed(this.world, this.planets, this.playerId);
      if (followed) {
        const renderPos =
          this.renderer.playerView.interpolatedWorld(alpha) ?? followed.position;
        const up = upAt(followed.planet, renderPos);
        this.rig.update(renderPos, up, (origin, dir, maxDist) =>
          this.colliders.castTerrainRay(origin, dir, this.planets, maxDist),
        );
        this.renderer.applyRigCamera(renderPos, this.rig.position, up);
      }
      activePos = this.rig.position;
    }
    const shift = maybeShiftOrigin(activePos);
    if (shift) {
      this.renderer.applyOriginShift(shift);
    }

    // Day/night environment (M05): sun, sky, atmosphere and fog follow the
    // sim clock. The shadow cascade stays near the player (third-person) or
    // the camera (fly mode); the sky uses the camera position.
    const lampPlayer = this.playerId ? this.world.entities.get(this.playerId) : undefined;
    const focusWorld = flying
      ? activePos
      : (this.renderer.playerView.interpolatedWorld(alpha) ?? lampPlayer?.position ?? activePos);
    const env = computeEnvironment(
      this.world,
      this.planets,
      activePos,
      focusWorld,
      lampPlayer?.components.player?.headlampOn ?? true,
    );
    this.renderer.updateEnvironment(env);
    const depthBelowM = env.depthBelowM;

    // LOD streaming around the active camera (priority queue + 4 ms apply
    // budget). Chunk meshes are positioned when added and re-synced on
    // origin shifts only.
    this.renderer.updateStreaming(activePos);
    this.renderer.renderPlayer(alpha);
    // Items, nodes, backpack and glow lights (M07) + the HUD slot bar.
    {
      const frame = backpackFrame(this.world, flying ? null : this.playerId, flying);
      this.renderer.renderEntities(this.world.entities.values(), focusWorld, frame.carriedItemIds);
      this.hud.update({
        slots: frame.slotDefs,
        selectedSlot: frame.selectedSlot,
        soil: frame.soil,
        prompt: frame.prompt,
      });
    }
    // Terrain brush preview: translucent sphere at the aim point (hidden in
    // fly mode or when nothing is in range). Re-set every frame from world
    // doubles, so origin shifts can never desync it.
    this.renderer.setToolPreview(
      flying || !this.toolAim.hit ? null : this.toolAim.hit,
      this.tool.radius,
    );
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
