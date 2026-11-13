import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import { TOOL_RANGE_M } from '../../src/core/constants.js';
import { distance, normalize, sub } from '../../src/core/math.js';
import { computeCursorAim, type CursorAimArgs } from '../../src/game/cursorAim.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import { World } from '../../src/sim/world.js';

describe('cursor terrain aim', () => {
  for (const planet of [SELA, VORN]) {
    for (const zoom of [2, 4, 8]) {
      it(`projects onto the cursor on ${planet.id} at ${zoom} m zoom`, () => {
        const pos = { ...planet.center, y: planet.center.y + planet.radius + 1 };
        const head = new Vector3(pos.x, pos.y + 1.5, pos.z);
        const camera = new PerspectiveCamera(65, 16 / 9, 0.1, 1000);
        camera.position.copy(head).add(new Vector3(0, zoom * 0.6, -zoom * 0.8));
        camera.lookAt(head);
        camera.updateMatrixWorld();
        const groundY = planet.center.y + planet.radius;
        for (const cursor of [new Vector2(0, 0), new Vector2(-0.2, -0.2), new Vector2(0.2, -0.3)]) {
          const screen = new Raycaster();
          screen.setFromCamera(cursor, camera);
          const base: CursorAimArgs = {
            world: new World(), playerId: null,
            followed: { position: pos, planet }, renderPos: pos,
            field: { config: planet, density: (_x, y) => planet.radius - y, caveThresholdAt: () => 0 },
            cursorOrigin: screen.ray.origin, cursorDir: screen.ray.direction,
            castRay: (origin, dir) => (groundY - origin.y) / dir.y,
            detailed: false, cursorMode: false,
          };
          for (const detailed of [false, true]) {
            // The fallback during collider rebuilds must hit the same pixel.
            for (const fallback of [false, true]) {
              if (fallback && !detailed) continue;
              const { aim, ray } = computeCursorAim({
                ...base, detailed, castRay: fallback ? () => null : base.castRay,
              });
              expect(aim.hit).not.toBeNull();
              if (!aim.hit) throw new Error('Expected in-range cursor hit');
              const projected = new Vector3(aim.hit.x, aim.hit.y, aim.hit.z).project(camera);
              expect(projected.x).toBeCloseTo(cursor.x, 8);
              expect(projected.y).toBeCloseTo(cursor.y, 8);
              expect(distance(aim.hit, head)).toBeLessThanOrEqual(TOOL_RANGE_M);
              expect(aim.ray).toEqual(ray);
              expect(aim.normal !== null).toBe(detailed);
            }
          }
        }
      });
    }
  }

  it('rejects distant terrain without moving the brush to a different point', () => {
    const pos = { x: 0, y: SELA.radius + 1, z: 0 };
    const camera = { x: 0, y: pos.y + 5, z: -6 };
    const target = { x: 0, y: SELA.radius, z: TOOL_RANGE_M + 1 };
    for (const detailed of [false, true]) {
      for (const fallback of [false, true]) {
        const { aim } = computeCursorAim({
          world: new World(), playerId: null,
          followed: { position: pos, planet: SELA }, renderPos: pos,
          field: { config: SELA, density: (_x, y) => SELA.radius - y, caveThresholdAt: () => 0 },
          cursorOrigin: camera, cursorDir: normalize(sub(target, camera)),
          castRay: fallback ? () => null : () => distance(camera, target),
          detailed, cursorMode: false,
        });
        expect(aim.hit).toBeNull();
      }
    }
  });
});
