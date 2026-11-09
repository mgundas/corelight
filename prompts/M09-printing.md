# M09: Printing (backpack printer and small printer)

## Goal
Turn resources into useful objects. Data-driven recipes, a backpack printer, and a placeable small printer.

## Tasks
1. `src/data/recipes.json`: every recipe from `docs/PROJECT.md` with `id`, `output` (item or placeable id), `inputs` (item id + count), `station` (`'backpack' | 'small_printer' | 'medium_printer' | 'furnace' | 'refinery'`), `time` (seconds), `power` (per second, 0 for backpack), and `unlockedByDefault`. Validate at load.
2. Placeables: some outputs are placeable objects (platform, small printer, solar panel, battery, furnace, research station, medium printer, refinery, shuttle, habitat kit). Define them in `src/data/placeables.json` with size, model shape description and snap points.
3. `src/sim/systems/crafting.ts`:
   - Backpack printing: action `printBackpack(recipeId)`. Checks the recipe is unlocked and inputs are in the backpack, consumes them, outputs the item into a free slot (or drops it if full). Instant for v1.
   - Station printing: action `printAtStation(stationId, recipeId)`. Inputs must be in the station's input slots (the player places items into them with E while holding them). Takes `time` seconds. Requires power if `power > 0` (power system comes in M10; for now treat stations as always powered via a temporary flag in constants that M10 removes).
   - Unit tested: missing inputs fail, locked recipe fails, output appears after time passes.
4. Placement mode: when a placeable is printed, it appears as a "packaged" item the player can carry (large items are carried in front of the player instead of in the backpack, slowing movement 30 percent). Pressing E on the ground enters placement mode: ghost preview aligned to the local up vector, green if the ground is flat enough (normal within 20 degrees of up and space is free), click to place.
5. The starting base gets one small printer pre-placed on the habitat.
6. UI (`src/ui/printerUi.ts`): Tab opens the backpack printer list; looking at a station and pressing E opens its recipe list. Show inputs, counts you have, and locked recipes greyed out.
7. Light sticks: placeable small item (from backpack printer) that sticks to the surface where thrown/placed and emits light.
8. Views for all new objects using simple low-poly procedural geometry with a consistent style (white/grey bodies, orange accents).

## Out of scope
Power simulation (M10), research unlocking (M11), furnace and refinery behavior (M12).

## Acceptance criteria
- `npm run check` passes.
- Mining resin and printing tethers in the backpack works.
- Printing a platform at the small printer, carrying it, and placing it on flat ground works.
- Light sticks light up a dark cave.
- Recipes can be changed only by editing the JSON file (demonstrate by describing it in the PROGRESS note).

## Finish
Update `docs/PROGRESS.md`. Commit: `M09: printing`.
