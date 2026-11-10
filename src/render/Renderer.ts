import * as THREE from 'three';
import { SELA } from '../planets/configs/sela.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import type { Vec3d } from '../core/math.js';
import { ChunkManager, type FrustumPlane, type StreamStats } from '../terrain/chunkManager.js';
import { MeshWorkerPool, type MeshResult } from '../terrain/workerPool.js';
import { ChunkBounds } from './chunkBounds.js';
import { ChunkMeshes } from './chunkMeshes.js';
import { frustumPlanes } from './frustum.js';

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

    this.streamer = new ChunkManager(this.pool, this.chunks, planets, worldSeed);
    for (const pre of prebuilt) this.streamer.adopt(pre.planet, pre.results, pre.emptyKeys);

    this.handleResize = (): void => this.onResize();
    window.addEventListener('resize', this.handleResize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.pool.dispose();
    this.chunks.dispose();
    this.renderer.dispose();
  }

  /** Stream LOD around the camera; call every frame with the world position. */
  updateStreaming(cameraWorld: Vec3d): void {
    const frustum: FrustumPlane[] = frustumPlanes(this.camera);
    this.streamer.update(cameraWorld, frustum);
    if (this.bounds.isVisible()) this.bounds.update(this.chunks.boxes());
  }

  streamStats(): StreamStats {
    return this.streamer.stats();
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

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
