// Mining helper (M07, split from actions.ts in M10 so the action switch can
// stay under the 400-line rule). A dig stroke that moved terrain shakes one
// charge loose per overlapping node; exhausted nodes are removed and recorded
// in `depletedNodes` so the deterministic placer never brings them back.

import { distance, rotateVector, type Vec3d } from '../core/math.js';
import { isKnownItem } from '../data/loadData.js';
import { IDENTITY_QUAT } from '../core/math.js';
import type { World } from './world.js';

export function mineNodes(world: World, planetId: string, center: Vec3d, radius: number): void {
  if (!world.planets.some((p) => p.id === planetId)) return;
  for (const [id, entity] of [...world.entities]) {
    if (entity.kind !== 'node' || entity.planetId !== planetId) continue;
    const node = entity.components.node;
    if (!node || node.charges <= 0 || !isKnownItem(node.resourceId)) continue;
    if (distance(entity.position, center) > radius + 1.5) continue;
    node.charges -= 1;
    // Partial progress persists across far despawns (reapplied on respawn).
    // Full-charge nodes need no record (placement already derives them).
    if (node.charges !== node.maxCharges) world.nodeCharges.set(id, node.charges);
    else world.nodeCharges.delete(id);
    // Pop the item out along the node's own surface normal (its rotation's
    // +Y): ceiling nodes hang overhead, so radial up would bury the drop in
    // rock. Falls back to radial up when the rotation is missing.
    const normal = rotateVector({ x: 0, y: 1, z: 0 }, entity.rotation);
    const itemId = world.nextId('item');
    world.entities.set(itemId, {
      id: itemId,
      kind: 'item',
      planetId,
      position: {
        x: entity.position.x + normal.x * 1.0,
        y: entity.position.y + normal.y * 1.0,
        z: entity.position.z + normal.z * 1.0,
      },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: node.resourceId } },
    });
    if (node.charges <= 0) {
      world.entities.delete(id);
      world.nodeCharges.delete(id);
      world.depletedNodes.add(id);
    }
  }
}
