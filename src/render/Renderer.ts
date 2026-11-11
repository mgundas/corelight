import * as THREE from 'three';
import { SELA } from '../planets/configs/sela.js';
import type { PlanetConfig, Rgb } from '../planets/PlanetConfig.js';
import type { Quat, Vec3d } from '../core/math.js';
import { isKnownItem, itemDef, type ItemDef } from '../data/loadData.js';
import type { Entity } from '../sim/entities.js';
import { ChunkManager } from '../terrain/chunkManager.js';
import { toWorldPlanes, type StreamStats } from '../terrain/streaming.js';
import { MeshWorkerPool, type MeshResult } from '../terrain/workerPool.js';
import { Atmosphere } from './atmosphere.js';
import { ChunkBounds } from './chunkBounds.js';
import { ChunkMeshes } from './chunkMeshes.js';
import { getOrigin, toLocal } from './floatingOrigin.js';
import { frustumPlanes } from './frustum.js';
import { ItemLights } from './itemLights.js';
import { HabitatViews, MarkerViews, TetherViews } from './views/tetherView.js';
import { PlaceableViews, PlacementGhost } from './views/placeableView.js';
import { disposeItemCaches } from './views/itemGeometry.js';
import { syncEntityViews } from './views/syncViews.js';
import { ItemViews } from './views/itemView.js';
import { NodeViews } from './views/nodeView.js';
import { LightingRig } from './lighting.js';
import { Sky } from './sky.js';
import { PlayerView } from './views/playerView.js';

// M02 renderer: scene + LOD-streamed chunk meshes. The ChunkManager owns
// which chunks exist; pre-generation results (from the boot screen) are
// adopted before the first frame so the planet is never bare.
// M05: lighting/sky/atmosphere are owned here and driven per frame by Game
// from sim values (sun direction, depth below surface, headlamp state).

export interface PrebuiltTerrain {
  planet: PlanetConfig;
  results: MeshResult[];
  emptyKeys: string[];
}

/** Per-frame environment state, computed by Game from sim values. */
export interface EnvironmentUpdate {
  /** World-space unit sun direction (from the sim). */
  sunDirWorld: Vec3d;
  /** Shadow frustum follows this world point (third-person: near the player). */
  focusWorld: Vec3d;
  /** Sun elevation above the local horizon at the camera (-1..1, for sky). */
  elevation: number;
  /** Depth below the surface at the camera (sim formula, for sky/fog). */
  depthBelowM: number;
  /** Height above the nominal surface at the camera (meters, for sky/fog). */
  altitudeM: number;
  /** Sun elevation at the focus point (hemisphere fill + sun warmth). */
  focusElevation: number;
  /** Depth below the surface at the focus point (hemisphere dimming). */
  focusDepthBelowM: number;
  headlampOn: boolean;
  skyTint: Rgb;
  groundTint: Rgb;
  dayColor: Rgb;
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
  readonly itemViews = new ItemViews();
  readonly nodeViews = new NodeViews();
  readonly tetherViews = new TetherViews();
  readonly habitatViews = new HabitatViews();
  readonly markerViews = new MarkerViews();
  readonly placeableViews = new PlaceableViews();
  readonly placementGhost = new PlacementGhost();
  private readonly itemLights = new ItemLights();
  private readonly lighting: LightingRig;
  private readonly sky: Sky;
  private readonly atmosphere: Atmosphere;
  private readonly toolPreview: THREE.Mesh;
  private readonly toolPreviewMat: THREE.MeshBasicMaterial;

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
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      200000,
    );
    this.camera.position.set(0, 0, 600);

    this.lighting = new LightingRig(this.scene, this.camera);
    this.sky = new Sky(this.scene, this.camera, worldSeed);
    this.atmosphere = new Atmosphere(this.scene);
    for (const planet of planets) this.atmosphere.addPlanet(planet);
    this.scene.add(this.chunks.group);
    this.scene.add(this.bounds.group);
    this.scene.add(this.playerView.group);
    this.scene.add(this.itemViews.group);
    this.scene.add(this.nodeViews.group);
    this.scene.add(this.tetherViews.group);
    this.scene.add(this.habitatViews.group);
    this.scene.add(this.markerViews.group);
    this.scene.add(this.placeableViews.group);
    this.scene.add(this.placementGhost.group);
    this.scene.add(this.itemLights.group);
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
    this.itemViews.dispose();
    this.nodeViews.dispose();
    this.tetherViews.dispose();
    this.habitatViews.dispose();
    this.markerViews.dispose();
    this.placeableViews.dispose();
    this.placementGhost.dispose();
    this.itemLights.dispose();
    disposeItemCaches();
    this.bounds.dispose();
    this.lighting.dispose();
    this.sky.dispose();
    this.atmosphere.dispose();
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

  /** Drive sun, sky, atmosphere and fog from sim values (call every frame). */
  updateEnvironment(u: EnvironmentUpdate): void {
    this.lighting.update({
      sunDirWorld: u.sunDirWorld,
      focusWorld: u.focusWorld,
      elevation: u.focusElevation,
      depthBelowM: u.focusDepthBelowM,
      headlampOn: u.headlampOn,
      skyTint: u.skyTint,
      groundTint: u.groundTint,
    });
    this.sky.update({
      sunDirWorld: u.sunDirWorld,
      elevation: u.elevation,
      altitudeM: u.altitudeM,
      depthBelowM: u.depthBelowM,
      dayColor: u.dayColor,
    });
    this.atmosphere.update(u.sunDirWorld);
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
      // (LightingRig repositions the sun absolutely every frame anyway.)
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

  /**
   * Show the translucent placement ghost at a world-space point (null hides).
   * Oriented to local up; green when checkPlacement says ok, red otherwise.
   */
  setPlacementGhost(
    placeableId: string | null,
    positionWorld: Vec3d | null,
    upWorld: Vec3d | null,
    valid: boolean,
  ): void {
    this.placementGhost.set(placeableId, positionWorld, upWorld, valid);
  }

  /**
   * Sync ground items, resource nodes, placeables/light sticks, tethers,
   * habitats, markers, carried backpack items, then park the glow light pool
   * on the nearest emitters. `carried` holds the 8 resolved backpack slot
   * definitions (null for empty); `frontCarry` is the large packaged item in
   * front of the player. Unknown future item ids resolve to null (never crash
   * the frame).
   */
  renderEntities(
    entities: Iterable<Entity>,
    focusWorld: Vec3d,
    carried: (string | null)[],
    frontCarry: string | null,
  ): void {
    const { itemEmitters, nodeEmitters, placeableEmitters } = syncEntityViews(this, entities);
    this.itemLights.update(focusWorld, [...itemEmitters, ...nodeEmitters, ...placeableEmitters]);
    this.playerView.renderBackpack(
      carried.map((id) => (id && isKnownItem(id) ? itemDef(id) : null) as ItemDef | null),
    );
    this.playerView.renderFrontCarry(frontCarry && isKnownItem(frontCarry) ? itemDef(frontCarry) : null);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
