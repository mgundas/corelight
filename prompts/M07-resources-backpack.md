# M07: Resources, physical items and the backpack

## Goal
Resources appear in the world, can be mined, become physical items, and fit into an 8-slot backpack. Items are data-driven.

## Tasks
1. `src/data/items.json`: every item from `docs/PROJECT.md` with `id`, `name`, `color`, `shape` (`'cube' | 'sphere' | 'crystal' | 'capsule' | 'canister'`), `size` (`'small' | 'medium' | 'large'`), `stackable` (false for v1: one item per slot, like Astroneer), `emitsLight` (optional color + intensity). `src/data/loadData.ts` validates the JSON at startup and throws clear errors.
2. Resource nodes (`kind: 'node'`): deterministic placement per LOD0 chunk using the chunk key + seed (so they are never stored unless changed). Rules from PROJECT.md: resin and silicate on the surface, ferrite and cuprite in the crust, cuprite and research samples in the mantle, lumen crystals on cave walls. Each node has 2 to 5 "charges". Nodes are only spawned for chunks near the player; removed when far. Mined/depleted nodes are recorded in World state (`depletedNodes: Set<nodeId>`) and saved.
3. Node placement must sit on terrain: find a surface point inside the chunk using the density function (surface nodes: from the sky down; cave nodes: points where density changes sign near a cave wall). Orient nodes to the local normal.
4. Mining: digging (terrain tool) a node reduces its charges and spawns a physical item entity next to it. Items are Rapier dynamic bodies with custom gravity.
5. Backpack: `inventory` component with 8 slots on the player. Actions: `pickUp(itemId)` (E while looking at an item within 3 m), `drop(slot)` (Q), `selectSlot(n)`.
6. Items in the backpack are visible: small item meshes attached to the astronaut's backpack in their slot positions.
7. `src/render/views/itemView.ts` and `nodeView.ts`: low-poly procedural meshes per shape with the item color. Lumen crystals emit light (use the PointLight budget from ARCHITECTURE.md).
8. HUD (`src/ui/hud.ts`): slot bar at the bottom, soil counter, interaction prompt ("E: pick up Resin").
9. Tests: node placement is deterministic for a chunk; picking up into a full backpack fails; drop puts the item in front of the player.

## Out of scope
Crafting (M09), oxygen (M08).

## Acceptance criteria
- `npm run check` passes.
- Walking around you find resin and silicate nodes on the surface, and ores and glowing crystals in caves.
- Mining a node pops out items that fall with spherical gravity and rest on the ground.
- You can carry up to 8 items, see them on the backpack, drop them, and pick them up again.
- Reloading keeps depleted nodes depleted and items where they were left.

## Finish
Update `docs/PROGRESS.md`. Commit: `M07: resources and backpack`.
