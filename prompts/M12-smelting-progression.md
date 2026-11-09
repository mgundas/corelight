# M12: Smelting, drill upgrades and the descent

## Goal
Make going deeper a progression: smelt ores into metals, craft drill upgrades to break harder layers, and make the mantle dangerous.

## Tasks
1. Furnace machine: one input slot, one output, needs 2 power/s while working, 10 s per recipe (furnace recipes from recipes.json: ferrite ore to iron, cuprite ore to copper, resin to polymer). Biomass in a second slot doubles speed and is consumed (optional fuel).
2. Medium printer machine (larger platform footprint) with its recipes.
3. Drill upgrades: Drill Mk2 and Mk3 are items. Holding one in a selected backpack slot sets `toolHardness` (Mk2 = 3, Mk3 = 4). Mk3 also digs 30 percent faster. Show the current drill tier on the HUD.
4. Mantle heat hazard: below the mantle depth, oxygen drains 2x and a subtle orange heat haze/vignette is shown. Hazard multipliers are defined in the planet config, not hardcoded.
5. Biomass plants on Sela's surface: small low-poly plants placed like nodes; mining gives Biomass.
6. Balance check: write a short table in PROGRESS.md of the shortest path from new game to Drill Mk3 (which items, how many, rough time). Adjust node densities in the planet config if anything is impossible or tedious.
7. Tests: furnace processing over time with and without power; toolHardness from held drill.

## Out of scope
Refinery (M14), core chamber content (M15).

## Acceptance criteria
- `npm run check` passes.
- Full chain works: mine ore, smelt in a powered furnace, print Drill Mk2 at the small printer, dig into the mantle.
- Mk3 lets you break the core shell and drop into the core chamber.
- The mantle feels dangerous because of faster oxygen drain, so you need tethers or canisters to dig deep.

## Finish
Update `docs/PROGRESS.md`. Commit: `M12: smelting and progression`.
