// Terrain tool state (M04): brush radius plus stroke bookkeeping for the
// dig/add/flatten modes. Input sampling (raycast) stays in Game; this owns
// rate limiting (10 edits/s) and captures the flatten plane at stroke start.
// Emits terrainEdit Actions, so all sim mutation stays in applyAction.

import {
  TOOL_DEFAULT_RADIUS,
  TOOL_DIG_STRENGTH,
  TOOL_EDITS_PER_SECOND,
  TOOL_MAX_RADIUS,
  TOOL_MIN_RADIUS,
} from '../core/constants.js';
import type { Vec3d } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import type { Action } from '../sim/actions.js';

export interface ToolButtons {
  dig: boolean;
  add: boolean;
  flatten: boolean;
}

export interface ToolAim {
  hit: Vec3d | null;
  normal: Vec3d | null;
  planet: PlanetConfig | null;
}

export class TerrainTool {
  radius = TOOL_DEFAULT_RADIUS;
  private flattenPlane: { point: Vec3d; normal: Vec3d } | null = null;
  private lastEditAt = -Infinity;

  /** Ctrl+wheel brush sizing (1 to 4 m in half-meter steps). */
  adjustRadius(deltaY: number): void {
    const step = deltaY > 0 ? -0.5 : 0.5;
    this.radius = Math.min(TOOL_MAX_RADIUS, Math.max(TOOL_MIN_RADIUS, this.radius + step));
  }

  /**
   * Build a terrainEdit action when a stroke bit is due, else null. Mode
   * priority: dig, then add, then flatten. The flatten plane is captured
   * from the aim normal on the first held frame with valid aim (so
   * pressing F while looking at the sky still starts a stroke once the
   * aim lands) and frozen for the rest of the stroke; releasing F clears
   * it for the next stroke.
   */
  update(nowMs: number, playerId: string, buttons: ToolButtons, aim: ToolAim): Action | null {
    if (!buttons.flatten) {
      this.flattenPlane = null;
    } else if (!this.flattenPlane && aim.hit && aim.normal) {
      this.flattenPlane = { point: { ...aim.hit }, normal: { ...aim.normal } };
    }
    const mode = buttons.dig ? 'dig' : buttons.add ? 'add' : buttons.flatten ? 'flatten' : null;
    if (!mode || !aim.hit || !aim.planet) return null;
    if (mode === 'flatten' && !this.flattenPlane) return null;
    if (nowMs - this.lastEditAt < 1000 / TOOL_EDITS_PER_SECOND) return null;
    this.lastEditAt = nowMs;
    const plane = this.flattenPlane;
    return {
      type: 'terrainEdit',
      playerId,
      planetId: aim.planet.id,
      mode,
      center: { ...aim.hit },
      radius: this.radius,
      strength: TOOL_DIG_STRENGTH,
      flattenPlane:
        mode === 'flatten' && plane
          ? { point: { ...plane.point }, normal: { ...plane.normal } }
          : undefined,
    };
  }
}
