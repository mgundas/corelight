# M06: Save and load, and an architecture checkpoint

## Goal
Persist the world (terrain edits, player, entities, time) to IndexedDB, and verify the codebase still follows the hard rules before gameplay systems pile on top of it.

## Tasks
1. `src/save/serialize.ts`: `serializeWorld(world)` and `deserializeWorld(data)` as described in ARCHITECTURE.md. Include a `version: 1` field and a `migrations` map (empty for now). Terrain edits are stored per chunk as base64 encoded Float32 data.
2. `src/save/storage.ts`: save/load with idb-keyval under `corelight-save-v1`. Autosave every 60 s and on `visibilitychange` to hidden.
3. Main menu (`src/ui/menu.ts`), shown after the boot screen: Continue (only if a save exists), New game (asks to confirm overwriting), Settings placeholder. Esc during play opens a pause menu with Resume, Save now, Quit to menu.
4. On load: restore edits before chunk streaming starts so edited areas never appear unedited.
5. Tests: round trip test `deserialize(serialize(world))` equals the original for a world with several entities and edits; same seed + same edits gives identical density values.
6. Architecture checkpoint. Check and report the result of each of these in your final reply:
   - `grep -r "from 'three'" src/sim src/terrain` returns nothing.
   - All gameplay state changes go through `dispatch` (search for direct mutations of World from `src/player`, `src/ui`, `src/render`).
   - No file in `src/` is above 400 lines (list any and split them).
   - No `any` types (`grep -rn ": any\|as any" src`).
   Fix every violation found.

## Out of scope
Cloud saves, multiple save slots.

## Acceptance criteria
- `npm run check` passes.
- Dig a few tunnels, build a hill, reload the page, choose Continue: everything is exactly as left, including the player position and time of day.
- New game resets the world.
- The checkpoint report shows zero violations.

## Finish
Update `docs/PROGRESS.md`. Commit: `M06: save/load and architecture checkpoint`.
