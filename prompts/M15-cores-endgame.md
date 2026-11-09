# M15: Core chambers and the endgame

## Goal
Make the cores worth reaching: atmospheric core chambers with an ancient engine on each planet, a cross-planet activation goal and an ending.

## Tasks
1. Core chamber dressing: when the player is in a core chamber, the chamber glows (planet `core.chamberColor`), floating rock islands and crystal clusters are placed deterministically inside it (as entities or as part of the density function, choose the cheaper and explain), and low gravity already exists from M03.
2. Ancient engine entity at each planet's center: a large low-poly structure (rings around a central column). It has an activation socket requiring 3 items: Sela needs 3 Voidstone, Vorn needs 3 Heartglass. Insert items with E.
3. Heartglass: special nodes only in Sela's core chamber (around 6). Voidstone: Vorn mantle nodes (from M13).
4. Activation: when an engine has all 3 items, it activates: rings spin, light pulses, and its planet's atmosphere tint shifts slightly. Engine state is saved.
5. Ending: when both engines are active, a beam of light connects the two planets (visible from anywhere), a short ending sequence plays (camera pull-out to show both planets and the beam, text overlay "Corelight", credits text), then the player returns to free play.
6. Core samples: research samples in core chambers are worth 40 Data (from M11) and a few are placed there.
7. Guidance: a simple objectives panel (toggle with O) listing the main goals in order: Build a base, Research power, Smelt metal, Reach the mantle, Reach Sela's core, Build a shuttle, Reach Vorn, Activate both engines. Each completes automatically from world state.

## Out of scope
Story dialogue, NPCs.

## Acceptance criteria
- `npm run check` passes.
- Both engines can be activated through normal play, and the ending plays once.
- The objectives panel reflects progress and survives save/load.

## Finish
Update `docs/PROGRESS.md`. Commit: `M15: cores and endgame`.
