import * as THREE from 'three';
import { SELA } from '../planets/configs/sela.js';
import { MeshWorkerPool } from '../terrain/workerPool.js';
import { ChunkMeshes } from './chunkMeshes.js';
import { loadPreviewTerrain, type PreviewProgress } from './previewTerrain.js';

// M01 renderer: scene + chunk meshes streamed from mesh workers.
// The placeholder sphere is gone; M02 adds LOD streaming and atmosphere.

// Fixed world-space sun direction (directional light, infinite distance).
const SUN_DIRECTION = new THREE.Vector3(1, 0.6, 0.4).normalize();

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly chunks = new ChunkMeshes();
  readonly pool = new MeshWorkerPool();
  preview: PreviewProgress = { loaded: 0, added: 0, total: 0 };
  previewDone = false;

  private sun: THREE.DirectionalLight;
  private readonly handleResize: () => void;

  constructor(canvas: HTMLCanvasElement, worldSeed: number) {
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

    // M01 fixed set: fire-and-forget; meshes pop in as workers finish.
    // M02 replaces this with LOD streaming behind the boot screen.
    void loadPreviewTerrain(this.pool, this.chunks, SELA, worldSeed, (progress) => {
      this.preview = progress;
      this.syncObjects();
    }).then((progress) => {
      this.preview = progress;
      this.previewDone = true;
      this.syncObjects();
    });

    this.handleResize = (): void => this.onResize();
    window.addEventListener('resize', this.handleResize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.pool.dispose();
    this.chunks.dispose();
    this.renderer.dispose();
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
      obj.position.x -= delta.x;
      obj.position.y -= delta.y;
      obj.position.z -= delta.z;
    }
    // Re-sync authoritative positions on top to avoid drift.
    this.syncObjects();
    // Sun stays at a fixed local offset so its direction never changes.
    this.sun.position.copy(SUN_DIRECTION).multiplyScalar(1000);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
