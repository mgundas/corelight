// Kinematic character movement on a spherical planet (ARCHITECTURE.md:
// Rapier KinematicCharacterController with a capsule; "up" follows the
// direction away from the planet center). No three.js here: positions are
// doubles, Rapier runs in the planet-local frame (frames.ts), and entity
// position stays the source of truth. step() calls world.step() to refresh
// Rapier queries after collider moves; there are no dynamic bodies in M03.

import RAPIER from '@dimforge/rapier3d-compat';
import {
  CARRY_SLOW_MULT,
  PLAYER_CONTROLLER_OFFSET,
  PLAYER_HALF_HEIGHT,
  PLAYER_JUMP_SPEED,
  PLAYER_MAX_CLIMB_DEG,
  PLAYER_MIN_SLIDE_DEG,
  PLAYER_RADIUS,
  PLAYER_SNAP_DISTANCE,
  PLAYER_SPRINT_SPEED,
  PLAYER_STEP_HEIGHT,
  PLAYER_WALK_SPEED,
} from '../../core/constants.js';
import {
  add,
  dot,
  normalize,
  scale,
  sub,
  type Vec3d,
} from '../../core/math.js';
import type { PlanetConfig } from '../../planets/PlanetConfig.js';
import type { Entity } from '../entities.js';
import type { PlayerInputState } from '../entities.js';
import { moveBasis, orientationForUpYaw, toLocalFrame, toWorldFrame, upAt } from './frames.js';
import { gravityAt } from './gravity.js';
import { physicsWorldFor } from './rapierWorld.js';

const DEG = Math.PI / 180;

/** Owns the Rapier controller + capsule collider for one player entity. */
export class PlayerBody {
  private planetId: string | null = null;
  private world: RAPIER.World | null = null;
  private controller: RAPIER.KinematicCharacterController | null = null;
  private collider: RAPIER.Collider | null = null;
  private readonly worldFor: (planetId: string) => RAPIER.World;

  constructor(worldFor: (planetId: string) => RAPIER.World = physicsWorldFor) {
    this.worldFor = worldFor;
  }

  /** Rebind to a planet's Rapier world (recreates controller + collider). */
  ensureBound(planet: PlanetConfig, localPos: Vec3d): void {
    if (this.planetId === planet.id && this.controller && this.collider && this.world) return;
    this.dispose();
    const world = this.worldFor(planet.id);
    this.world = world;
    this.controller = world.createCharacterController(PLAYER_CONTROLLER_OFFSET);
    this.controller.setMaxSlopeClimbAngle(PLAYER_MAX_CLIMB_DEG * DEG);
    this.controller.setMinSlopeSlideAngle(PLAYER_MIN_SLIDE_DEG * DEG);
    this.controller.enableAutostep(PLAYER_STEP_HEIGHT, 0.2, true);
    this.controller.enableSnapToGround(PLAYER_SNAP_DISTANCE);
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS).setTranslation(
        localPos.x,
        localPos.y,
        localPos.z,
      ),
    );
    this.planetId = planet.id;
  }

  dispose(): void {
    if (this.collider && this.planetId) {
      try {
        this.worldFor(this.planetId).removeCollider(this.collider, false);
      } catch {
        // World already disposed in tests; nothing to do.
      }
    }
    this.collider = null;
    this.controller?.free();
    this.controller = null;
    this.world = null;
    this.planetId = null;
  }

  /**
   * Advance one tick. Reads intent + look from the entity, writes position,
   * rotation, velocity, grounded. Caller guarantees colliders are loaded
   * (frozen otherwise) and a planet is in range.
   */
  step(entity: Entity, planets: PlanetConfig[], dt: number): void {
    const player = entity.components.player;
    if (!player) return;
    const sample = gravityAt(planets, entity.position);
    if (!sample.planet) return;
    const planet = sample.planet;
    const up = upAt(planet, entity.position);
    const local = toLocalFrame(planet, entity.position);
    this.ensureBound(planet, local);
    const controller = this.controller as RAPIER.KinematicCharacterController;
    const collider = this.collider as RAPIER.Collider;
    controller.setUp(up);

    const intent: PlayerInputState = player.input ?? { moveX: 0, moveZ: 0, jump: false, sprint: false };
    const { forward, right } = moveBasis(up, player.yaw, player.pitch);
    // Ground-projected wish direction (pitch aims the camera, not the feet).
    const flatFwd = normalize(sub(forward, scale(up, dot(forward, up))));
    let wish = add(scale(flatFwd, intent.moveZ), scale(right, intent.moveX));
    if (dot(wish, wish) > 1) wish = normalize(wish);
    // Carrying a large packaged placeable in front slows movement 30%
    // (PROJECT.md/M09). Sim state drives it, so replays and saves agree.
    const carryMult = player.carryingLarge ? CARRY_SLOW_MULT : 1;
    const speed = (intent.sprint ? PLAYER_SPRINT_SPEED : PLAYER_WALK_SPEED) * carryMult;

    // Vertical: integrate spherical gravity along up. While grounded the
    // vertical velocity resets to a small stick-down value (no accumulation:
    // accumulating would grow the per-tick step until it tunnels); jumping
    // replaces it with the takeoff speed.
    let upVel: number;
    if (player.grounded) {
      upVel = intent.jump ? PLAYER_JUMP_SPEED : -1;
    } else {
      upVel = dot(player.velocity, up) + dot(sample.vector, up) * dt;
    }
    const horizontal = scale(wish, speed);
    const desired = add(scale(horizontal, dt), scale(up, upVel * dt));

    collider.setTranslation(local);
    collider.setRotation(orientationForUpYaw(up, player.yaw));
    controller.computeColliderMovement(collider, { x: desired.x, y: desired.y, z: desired.z });
    const movement = controller.computedMovement();
    const nextLocal = { x: local.x + movement.x, y: local.y + movement.y, z: local.z + movement.z };
    collider.setTranslation(nextLocal);
    // No world.step() here: stepping is centralized at the end of the
    // physics system tick (single authority; item bodies share these
    // worlds, and stepping twice would integrate them 2x fast). Queries
    // run on last tick's broadphase, which is fine at fixed 30 Hz.
    player.grounded = controller.computedGrounded();
    player.input = null;

    entity.position = toWorldFrame(planet, nextLocal);
    // World-frame velocity: horizontal wish + integrated vertical.
    player.velocity = add(horizontal, scale(up, upVel));
    entity.rotation = orientationForUpYaw(up, player.yaw);
  }
}
