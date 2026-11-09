# M10: Base building and power

## Goal
Build a real base: platforms snap together, cables connect machines, and power flows from the habitat, solar panels and batteries to consumers.

## Tasks
1. Snap points: platforms have 4 snap points on their edges and 1 to 4 slots on top (from `placeables.json`). In placement mode, a placeable near a free snap point snaps to it (position and rotation). Machines placed on platform slots attach to the platform.
2. Cables: action `connectCable(fromSnapId, toSnapId)` while holding a cable tool (default tool, select with key C): click a source snap point, then a target within 10 m. Platforms connected by snapping are automatically connected. Cables are drawn as sagging lines.
3. `src/sim/systems/power.ts`:
   - Build power networks from the connection graph (recompute on changes only).
   - Each tick per network: generation (habitat +1/s, solar +2/s times `max(0, dot(sunDir, localUp))` and 0 if `isDaylight` is false), consumption (only machines currently working), storage (batteries, 100 each, plus the habitat's internal 20).
   - If generation + stored power cannot cover demand, machines pause (not partially work) in a stable priority order: printers first, furnace, refinery.
   - Remove the temporary "always powered" flag from M09.
   - Unit tested: day/night generation, battery charge and discharge, brownout pausing.
4. HUD: when looking at a machine, show its network: generation, demand, stored power, and the machine's state (working, paused: no power, idle).
5. Pick up placed objects: hold E on an empty machine/platform for 1 s to pack it back into a carryable item (refund nothing, it's the same item).
6. Views: solar panels tilt toward the sun; machines show a small status light (green working, yellow idle, red no power).

## Out of scope
Power transfer through tethers.

## Acceptance criteria
- `npm run check` passes.
- A base of 3+ platforms with a solar panel and a battery powers the small printer during the day and continues from the battery at night until it is empty.
- Disconnecting a cable splits the network and the machines on the unpowered side pause.
- Saving and loading keeps the base, cables and battery charge.

## Finish
Update `docs/PROGRESS.md`. Commit: `M10: base building and power`.
