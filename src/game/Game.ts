import { MAX_TICKS_PER_FRAME, SIM_DT } from '../core/constants.js';
import { events } from '../core/events.js';
import { distance, length, type Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { PLANETS } from '../planets/solarSystem.js';
import { layerAt } from '../terrain/density.js';
import { ColliderPool } from '../terrain/colliderPool.js';
import { getOrigin, maybeShiftOrigin, toLocal } from '../render/floatingOrigin.js';
import { Renderer, type PrebuiltTerrain } from '../render/Renderer.js';
import { CameraRig } from '../player/cameraRig.js';
import { FreeFlyCamera } from '../player/freeFlyCamera.js';
import { PlayerInput } from '../player/input.js';
import { World } from '../sim/world.js';
import type { EntityId } from '../sim/entities.js';
import { upAt } from '../sim/physics/frames.js';
import { disposePhysics, physicsWorldFor } from '../sim/physics/rapierWorld.js';
import { findSpawnPosition } from '../sim/physics/spawn.js';
import { makePhysicsSystem } from '../sim/physics/system.js';
import { TerrainColliders } from '../sim/physics/terrainColliders.js';
import { DebugOverlay } from '../ui/debugOverlay.js';

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
  readonly overlay = new DebugOverlay();

  private playerId: EntityId | null = null;
  private readonly colliders: TerrainColliders;
  private readonly colliderPool = new ColliderPool();

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
  private readonly planets: PlanetConfig[];
  private readonly unsubscribeOriginShifted: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    seed: number,
    planets: PlanetConfig[] = PLANETS,
    prebuilt: PrebuiltTerrain[] = [],
  ) {
    this.planets = planets;
    this.world = new World(seed);

    // Physics first: collider ring (worker-backed) + movement system, then
    // the spawn so the very first tick already freezes/requests correctly.
    this.colliders = new TerrainColliders(
      {
        request: (planet, worldSeed, coord) =>
          this.colliderPool.request({ planetConfig: planet, worldSeed, coord }),
      },
      physicsWorldFor,
    );
    this.world.addSystem(
      makePhysicsSystem({ planets, worldSeed: seed, colliders: this.colliders }),
    );
    const home = planets[0] as PlanetConfig;
    this.world.dispatch({
      type: 'spawnPlayer',
      planetId: home.id,
      position: findSpawnPosition(home, seed),
    });
    this.world.tick(SIM_DT);
    for (const entity of this.world.entities.values()) {
      if (entity.kind === 'player') {
        this.playerId = entity.id;
        break;
      }
    }

    this.renderer = new Renderer(canvas, seed, planets, prebuilt);
    this.flyCamera.speed = 60;
    this.flyCamera.enabled = false;
    this.flyCamera.attach(canvas, (speed) => {
      this.flySpeed = speed;
    });
    this.flySpeed = this.flyCamera.speed;
    this.input.attach(canvas, this.rig, this.rig);
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
    this.flyCamera.detach();
    this.input.detach();
    this.colliderPool.dispose();
    this.colliders.dispose();
    disposePhysics();
    this.overlay.dispose();
    this.renderer.dispose();
  }

  private playerEntity(): { position: Vec3d; planet: PlanetConfig } | null {
    const entity = this.playerId ? this.world.entities.get(this.playerId) : undefined;
    if (!entity) return null;
    const planet = this.planets.find((p) => p.id === entity.planetId) ?? this.nearestPlanet(entity.position);
    return { position: entity.position, planet };
  }

  private nearestPlanet(pos: Vec3d): PlanetConfig {
    let nearest = this.planets[0] as PlanetConfig;
    let best = Infinity;
    for (const planet of this.planets) {
      const d = distance(pos, planet.center);
      if (d < best) {
        best = d;
        nearest = planet;
      }
    }
    return nearest;
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
    this.accumulator += frameDt;
    let ticks = 0;
    const flying = this.flyCamera.enabled;
    while (this.accumulator >= SIM_DT && ticks < MAX_TICKS_PER_FRAME) {
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

    // Active camera: fly cam in F3 mode, orbit rig otherwise (streaming and
    // the origin shift follow whichever the player sees through).
    let activePos: Vec3d;
    if (flying) {
      this.flyCamera.update(frameDt);
      activePos = this.flyCamera.position;
      const local = toLocal(activePos);
      this.flyCamera.applyToCamera(this.renderer.camera, local);
    } else {
      const followed = this.playerEntity();
      if (followed) {
        const up = upAt(followed.planet, followed.position);
        this.rig.update(followed.position, up, (origin, dir, maxDist) =>
          this.renderer.raycastTerrain(origin, dir, maxDist),
        );
        this.renderer.applyRigCamera(followed.position, this.rig.position, up);
      }
      activePos = this.rig.position;
    }
    const shift = maybeShiftOrigin(activePos);
    if (shift) {
      this.renderer.applyOriginShift(shift);
    }

    // LOD streaming around the active camera (priority queue + 4 ms apply
    // budget). Chunk meshes are positioned when added and re-synced on
    // origin shifts only.
    this.renderer.updateStreaming(activePos);
    this.renderer.renderPlayer(this.accumulator / SIM_DT);
    this.renderer.render();

    // Debug overlay content. The overlay no-ops while hidden, so skip the
    // stats work (mesh counts, layer lookup) entirely in that case.
    if (this.overlay.isVisible()) {
      const followed = this.playerEntity();
      const planet = followed?.planet ?? this.nearestPlanet(activePos);
      const focus = followed?.position ?? activePos;
      const rel = {
        x: focus.x - planet.center.x,
        y: focus.y - planet.center.y,
        z: focus.z - planet.center.z,
      };
      const depth = planet.radius - length(rel);
      const stats = this.renderer.streamStats();
      const lod = stats.perLevel
        .map((count, level) => (count ? `L${level}:${count}` : null))
        .filter((part) => part !== null)
        .join(' ');
      const player = this.playerId ? this.world.entities.get(this.playerId) : undefined;
      this.overlay.update({
        fps: this.fps,
        tickMs: this.lastTickMs,
        cameraWorld: { ...activePos },
        origin: getOrigin(),
        drawCalls: this.renderer.renderer.info.render.calls,
        flySpeed: this.flySpeed,
        originShifts: this.originShifts,
        planet: planet.name,
        depthM: depth,
        layer: layerAt(planet, rel.x, rel.y, rel.z).name,
        lodCounts: lod,
        pendingJobs: stats.pending,
        cacheSize: stats.cacheSize,
        emptyChunks: stats.empty,
        desiredChunks: stats.desired,
        playerWorld: player ? { ...player.position } : undefined,
        grounded: player?.components.player?.grounded,
        pendingColliders: this.colliders.pendingCount,
        loadedColliders: this.colliders.loadedCount,
      });
    }
  }
}
