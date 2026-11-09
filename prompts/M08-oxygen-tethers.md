# M08: Habitat, oxygen and tethers

## Goal
Exploration gets tension. The starting habitat provides oxygen, tethers extend it, and running out of oxygen sends you back to the base.

## Tasks
1. Habitat entity (`kind: 'machine'`, `machineType: 'habitat'`) placed at game start next to the player spawn, on a flattened area (apply a flatten edit at spawn when a new game starts). Low-poly dome model with a door light. It is an oxygen source and later the root of the power network.
2. Tethers (`kind: 'tether'`): placed with T (action `placeTether`), costs one Tether item from the backpack. Placed at the ground under the player. Tether range 12 m.
3. `src/sim/systems/tethers.ts`: build the tether graph: tethers connect to each other and to habitats within 12 m and with line of sight (density raymarch between them, ignore tiny occlusions under 0.5 m). A tether is "live" if connected to a habitat. Recompute only when tethers are added/removed or terrain is edited nearby. Unit tested with a small graph.
4. `src/sim/systems/oxygen.ts`: player `oxygen` component (0 to 100). Inside range of a live tether or habitat: refill 20/s. Otherwise drain 1/s times hazard multipliers (mantle heat 2x; leave a hook for Vorn's cold). Unit tested.
5. Oxygen canister item: if the player has one in the backpack and oxygen hits 20, it auto-refills to 100 and is consumed.
6. Death: at 0 oxygen, fade to black, drop all backpack items as a group at the death position with a "lost backpack" marker on the HUD, respawn at the habitat with full oxygen.
7. `src/render/views/tetherView.ts`: small post with a glowing tip, cables drawn as sagging lines between connected tethers (catenary-ish curve), green when live, red when not.
8. HUD: oxygen bar (turns red and pulses below 25), "Tether range" indicator, distance and direction to the habitat when out of sight.
9. Add `?dev=1` param that puts 8 tethers in the backpack at spawn for testing.

## Out of scope
Power on tethers (keep it oxygen only in v1).

## Acceptance criteria
- `npm run check` passes.
- Walking away from the habitat drains oxygen; returning refills it.
- A chain of tethers into a cave keeps you alive; breaking the chain (removing a tether with E) makes the rest red.
- Dying respawns you at the habitat and your items wait at the death spot.
- Tether graph updates do not cause frame drops.

## Finish
Update `docs/PROGRESS.md`. Commit: `M08: oxygen and tethers`.
