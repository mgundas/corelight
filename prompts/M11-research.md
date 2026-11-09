# M11: Research and blueprint unlocks

## Goal
Give exploration a reward: research samples found in caves produce Data, which unlocks new blueprints.

## Tasks
1. `src/data/research.json`: a list of unlock entries `{ id, recipeIds, cost, requires: [ids] }`. Build a small tree from PROJECT.md, for example: Power basics (solar panel, battery), Smelting (furnace), Research station is unlocked by default, Advanced printing (medium printer), Drill Mk2, Drill Mk3 (requires Drill Mk2), Fuel refining (refinery), Spaceflight (shuttle, requires Fuel refining + Advanced printing), Outpost (habitat kit). Pick costs so the full tree needs roughly 15 samples total.
2. Research samples (`kind: 'sample'`): spawned deterministically like nodes, rarer, more common deeper (crust 1 per ~6 chunks, mantle 1 per ~3). They glow and pulse. Pick them up like items.
3. Research station: place a sample in its slot and it is processed over 20 s (needs 1 power/s), then adds Data to the World's `research.data` (sample value 10 in crust, 20 in mantle, 40 in core chambers).
4. `src/sim/systems/research.ts`: action `unlockResearch(id)` checks cost and requirements, deducts Data, unlocks the recipes. Unit tested.
5. Research UI (`src/ui/researchUi.ts`): E on the research station opens a tree/list view with costs, requirements and locked/unlocked state. Unlocking shows a short toast "New blueprint: Solar panel".
6. Lock everything that PROJECT.md says is not unlocked by default.

## Out of scope
New machines (they come in M12 to M14), only their unlock entries.

## Acceptance criteria
- `npm run check` passes.
- A new game cannot print solar panels until Power basics is researched.
- Bringing back samples from caves and processing them gives Data, and unlocking works.
- Research progress is saved.

## Finish
Update `docs/PROGRESS.md`. Commit: `M11: research`.
