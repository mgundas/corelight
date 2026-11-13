// Rapier ownership for one shuttle (M14). The arcade model decides velocity;
// this body supplies a real compound collider so terrain contacts stop the
// ship instead of letting it fly through hills. The world stays zero-gravity
// (single stepping authority in the physics system), and the body lives in
// the planet-local frame like every other sim body.

import RAPIER from '@dimforge/rapier3d-compat';
import type { Quat, Vec3d } from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import { toLocalFrame, toWorldFrame } from './frames.js';
import { physicsWorldFor } from './rapierWorld.js';

interface ShuttleBodySnapshot {
  position: Vec3d;
  rotation: Quat;
  velocity: Vec3d;
}

/** Compound collider sized from the catalog (base at y = 0, nose at +Y). */
function addCompoundColliders(world: RAPIER.World, body: RAPIER.RigidBody): void {
  // Hull capsule: main body volume.
  world.createCollider(
    RAPIER.ColliderDesc.capsule(0.55, 0.85)
      .setTranslation(0, 1.55, 0)
      .setFriction(0.7)
      .setRestitution(0.05),
    body,
  );
  // Two side thrusters.
  for (const side of [-1, 1]) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.3, 0.55, 0.4)
        .setTranslation(side * 1.05, 1.0, 0)
        .setFriction(0.6)
        .setRestitution(0.05),
      body,
    );
  }
  // Three landing legs (lowest points at the origin plane).
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.14, 0.25, 0.14)
        .setTranslation(Math.cos(angle) * 0.75, 0.25, Math.sin(angle) * 0.75)
        .setFriction(0.9)
        .setRestitution(0.02),
      body,
    );
  }
}

/** Owns the dynamic body for one shuttle while it is inside a planet SOI. */
export class ShuttleBody {
  private body: RAPIER.RigidBody | null = null;
  private planetId: string | null = null;
  private readonly worldFor: (planetId: string) => RAPIER.World;

  constructor(worldFor: (planetId: string) => RAPIER.World = physicsWorldFor) {
    this.worldFor = worldFor;
  }

  get boundPlanetId(): string | null {
    return this.planetId;
  }

  /** Create/rebind the body in a planet frame at the entity transform. */
  ensureBound(
    planet: PlanetConfig,
    worldPos: Vec3d,
    rotation: Quat,
    velocity: Vec3d,
  ): void {
    if (this.planetId === planet.id && this.body) return;
    this.dispose();
    const world = this.worldFor(planet.id);
    const local = toLocalFrame(planet, worldPos);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(local.x, local.y, local.z)
      .setRotation(rotation)
      .setLinvel(velocity.x, velocity.y, velocity.z)
      .setLinearDamping(0)
      .setAngularDamping(12)
      .setGravityScale(0)
      .setCcdEnabled(true);
    const body = world.createRigidBody(desc);
    addCompoundColliders(world, body);
    this.body = body;
    this.planetId = planet.id;
  }

  /** Contact-resolved transform/velocity from the last physics step. */
  read(planet: PlanetConfig): ShuttleBodySnapshot | null {
    if (!this.body || this.planetId !== planet.id) return null;
    const t = this.body.translation();
    const r = this.body.rotation();
    const v = this.body.linvel();
    return {
      position: toWorldFrame(planet, { x: t.x, y: t.y, z: t.z }),
      rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
      velocity: { x: v.x, y: v.y, z: v.z },
    };
  }

  /** Write the desired arcade state for the next central step. */
  write(planet: PlanetConfig, worldPos: Vec3d, rotation: Quat, velocity: Vec3d): void {
    if (!this.body || this.planetId !== planet.id) return;
    const local = toLocalFrame(planet, worldPos);
    this.body.setTranslation({ x: local.x, y: local.y, z: local.z }, true);
    this.body.setRotation(rotation, true);
    this.body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
  }

  dispose(): void {
    if (!this.body || !this.planetId) {
      this.body = null;
      this.planetId = null;
      return;
    }
    try {
      this.worldFor(this.planetId).removeRigidBody(this.body);
    } catch {
      // World already disposed in tests; nothing to do.
    }
    this.body = null;
    this.planetId = null;
  }
}
