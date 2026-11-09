import * as THREE from 'three';
import { PLACEHOLDER_PLANET_RADIUS, PLACEHOLDER_SPHERE_DETAIL } from '../core/constants.js';
import { toLocal } from './floatingOrigin.js';

// M00 renderer: scene + camera + one placeholder planet sphere.
// Later milestones add chunk meshes, atmosphere, entity views.

/** Fixed world-space sun direction (directional light, infinite distance). */
const SUN_DIRECTION = new THREE.Vector3(1, 0.6, 0.4).normalize();

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private planetMesh: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private readonly handleResize: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200000);
    this.camera.position.set(0, 0, 600);

    this.scene.background = new THREE.Color(0x05070f);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.position.copy(SUN_DIRECTION).multiplyScalar(1000);
    this.scene.add(this.sun);
    this.scene.add(new THREE.AmbientLight(0x8899bb, 0.5));

    const geometry = new THREE.IcosahedronGeometry(PLACEHOLDER_PLANET_RADIUS, PLACEHOLDER_SPHERE_DETAIL);
    const material = new THREE.MeshStandardMaterial({
      color: 0x4d7c5f,
      flatShading: true,
      roughness: 1,
      metalness: 0,
    });
    this.planetMesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.planetMesh);

    this.handleResize = (): void => this.onResize();
    window.addEventListener('resize', this.handleResize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.planetMesh.geometry.dispose();
    (this.planetMesh.material as THREE.Material).dispose();
    this.renderer.dispose();
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /** Reposition three.js objects from world-space doubles. */
  syncObjects(): void {
    // Planet center is at world (0,0,0).
    const local = toLocal({ x: 0, y: 0, z: 0 });
    this.planetMesh.position.set(local.x, local.y, local.z);
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
