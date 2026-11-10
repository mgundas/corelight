import * as THREE from 'three';
import { SELA } from '../planets/configs/sela.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import type { Quat, Vec3d } from '../core/math.js';
import { ChunkManager } from '../terrain/chunkManager.js';
import { toWorldPlanes, type StreamStats } from '../terrain/streaming.js';
import { MeshWorkerPool, type MeshResult } from '../terrain/workerPool.js';
import { ChunkBounds } from './chunkBounds.js';
import { ChunkMeshes } from './chunkMeshes.js';
import { getOrigin, toLocal } from './floatingOrigin.js';
import { frustumPlanes } from './frustum.js';
import { PlayerView } from './views/playerView.js';

// M02 renderer: scene + LOD-streamed chunk meshes. The ChunkManager owns
// which chunks exist; pre-generation results (from the boot screen) are
// adopted before the first frame so the planet is never bare.

// Fixed world-space sun direction (directional light, infinite distance).
const SUN_DIRECTION = new THREE.Vector3(1, 0.6, 0.4).normalize();

export interface PrebuiltTerrain {
  planet: PlanetConfig;
  results: MeshResult[];
  emptyKeys: string[];
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly chunks = new ChunkMeshes();
  readonly pool = new MeshWorkerPool();
  readonly streamer: ChunkManager;
  readonly bounds = new ChunkBounds();
  readonly playerView = new PlayerView();
  private readonly toolPreview: THREE.Mesh;
  private readonly toolPreviewMat: THREE.MeshBasicMaterial;

  private sun: THREE.DirectionalLight;
  private readonly handleResize: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    worldSeed: number,
    planets: PlanetConfig[] = [SELA],
    prebuilt: PrebuiltTerrain[] = [],
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      200000,
    );
    this.camera.position.set(0, 0, 600);

    this.scene.background = new THREE.Color(0x05070f);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.position.copy(SUN_DIRECTION).multiplyScalar(1000);
    this.scene.add(this.sun);
    this.scene.add(new THREE.AmbientLight(0x8899bb, 0.5));
    this.scene.add(this.chunks.group);
    this.scene.add(this.bounds.group);
    this.scene.add(this.playerView.group);
    // Translucent brush sphere for the terrain tool (M04). Positioned
    // absolutely from world doubles every frame, so it owns its origin
    // shifts (like the chunk and player groups).
    this.toolPreviewMat = new THREE.MeshBasicMaterial({
      color: 0x66ffcc,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    this.toolPreview = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), this.toolPreviewMat);
    this.toolPreview.visible = false;
    this.toolPreview.userData['originManaged'] = true;
    this.scene.add(this.toolPreview);

    this.streamer = new ChunkManager(this.pool, this.chunks, planets, worldSeed);
    for (const pre of prebuilt) this.streamer.adopt(pre.planet, pre.results, pre.emptyKeys);

    this.handleResize = (): void => this.onResize();
    window.addEventListener('resize', this.handleResize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.pool.dispose();
    this.chunks.dispose();
    this.playerView.dispose();
    this.toolPreview.geometry.dispose();
    this.toolPreviewMat.dispose();
    this.renderer.dispose();
  }

  /** Stream LOD around the camera; call every frame with the world position. */
  updateStreaming(cameraWorld: Vec3d): void {
    // Frustum planes come out of the camera in render-local space; the
    // streamer tests world-frame chunk boxes, so translate by the origin.
    const worldPlanes = toWorldPlanes(frustumPlanes(this.camera), getOrigin());
    this.streamer.update(cameraWorld, worldPlanes);
    if (this.bounds.isVisible()) this.bounds.update(this.chunks.boxes());
  }

  streamStats(): StreamStats {
    return this.streamer.stats();
  }

  /** Third-person view: camera behind `camWorld`, looking at `headWorld`. */
  applyRigCamera(headWorld: Vec3d, camWorld: Vec3d, upWorld: Vec3d): void {
    const head = toLocal(headWorld);
    const cam = toLocal(camWorld);
    this.camera.up.set(upWorld.x, upWorld.y, upWorld.z);
    this.camera.position.set(cam.x, cam.y, cam.z);
    this.camera.lookAt(head.x, head.y, head.z);
  }

  setWireframe(enabled: boolean): void {
    this.chunks.setWireframe(enabled);
  }

  setBoundsVisible(visible: boolean): void {
    this.bounds.setVisible(visible);
    if (visible) this.bounds.update(this.chunks.boxes());
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /** Reposition three.js objects from world-space doubles. */
  syncObjects(): void {
    this.chunks.syncAll();
  }

  /** Shift all scene children by -delta after an origin shift. */
  applyOriginShift(delta: { x: number; y: number; z: number }): void {
    for (const obj of this.scene.children) {
      // Lights encode direction, not world position: shifting the sun would
      // change the lighting direction, so leave them in the local frame.
      if (obj instanceof THREE.Light) continue;
      // Groups that position children absolutely from world doubles manage
      // their own re-sync; shifting them as well would move meshes twice.
      if (obj.userData['originManaged'] === true) continue;
      obj.position.x -= delta.x;
      obj.position.y -= delta.y;
      obj.position.z -= delta.z;
    }
    // Re-sync authoritative positions on top to avoid drift.
    this.syncObjects();
    this.bounds.resync(delta);
    // Sun stays at a fixed local offset so its direction never changes.
    this.sun.position.copy(SUN_DIRECTION).multiplyScalar(1000);
  }

  /** Record the player state after a sim tick (call once per tick). */
  pushPlayerSample(pos: Vec3d, quat: Quat): void {
    this.playerView.pushSample(pos, quat);
  }

  /**
   * Show the terrain brush sphere at a world-space hit (null hides it).
   * Call every frame: the position re-syncs from doubles, so origin shifts
   * can never desync it.
   */
  setToolPreview(centerWorld: Vec3d | null, radius: number): void {
    if (!centerWorld) {
      this.toolPreview.visible = false;
      return;
    }
    this.toolPreview.visible = true;
    const local = toLocal(centerWorld);
    this.toolPreview.position.set(local.x, local.y, local.z);
    this.toolPreview.scale.setScalar(Math.max(0.01, radius));
  }

  /** Place the astronaut view between the last two tick samples. */
  renderPlayer(alpha: number): void {
    this.playerView.render(alpha);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
