# Corelight: Project Overview

Working title: **Corelight**. A browser-based, single-player space exploration and base-building game inspired by Astroneer. You land on a small spherical planet, dig through deformable terrain, explore cave systems, reach the planet's core, build a base, and fly seamlessly (no loading screens) to a second planet.

This file describes WHAT the game is. `docs/ARCHITECTURE.md` describes HOW it is built. `docs/PROGRESS.md` describes what is already done.

## Design pillars

1. **The ground is the game.** Everything is diggable. Smooth terrain (not blocks), natural caves, and a reachable core.
2. **Exploration has tension.** Oxygen runs out away from your base. Tethers are your lifeline.
3. **Seamless worlds.** Walk, dig, fly to space and land on another planet without ever seeing a loading screen (except one at game start).
4. **Readable, stylized look.** Low-poly, vertex colors, smooth-shaded terrain with flat-shaded props, strong silhouettes, soft fog. No texture-heavy art.

## Player experience loop

1. Wake up next to a small habitat (the base). The habitat gives oxygen and a little power.
2. Use the terrain tool to dig. Digging gives Soil. Find resource nodes on the surface and in caves.
3. Carry resources in an 8-slot backpack. Print tethers and light sticks with the backpack printer.
4. Place tethers to extend oxygen deeper into caves.
5. Bring research samples back to the base to earn Data, unlock new blueprints.
6. Build platforms, printers, solar panels, batteries, a furnace. Smelt ores into metals.
7. Upgrade the drill to break through harder layers. Reach the core chamber.
8. Build a shuttle, fly to the second planet, set up a new base, find its unique resource.
9. Activate the ancient engines in both cores to finish the game.

## Planets (v1 has two)

Both planets use the same generator with different config files (`src/planets/configs/*.ts`).

| | **Sela** (home) | **Vorn** (second) |
|---|---|---|
| Theme | Temperate, green and brown surface, ochre caves | Cold, pale blue ice and grey rock, violet glow deep down |
| Radius | 400 m | 320 m |
| Caves | 7 pocketed floors (~14 m rooms in 32 m slabs, rare worm-pierced openings) | Cavern floors TBD (Vorn config arrives with M13), dense narrow worms |
| Unique resource | Heartglass (core chamber only) | Voidstone (mantle only) |
| Hazard | None on surface, heat in mantle | Cold on surface (oxygen drains 1.5x), heat in mantle |
| Core | Hollow chamber, radius 40 m, ancient engine | Hollow chamber, radius 32 m, ancient engine |

### Layers (depth measured from the nominal surface radius)

| Layer | Sela depth | Vorn depth | Hardness | Notes |
|---|---|---|---|---|
| Surface | 0 to 30 m | 0 to 25 m | 1 | Sunlit, basic resources |
| Crust | 30 to 140 m | 25 to 110 m | 2 | Natural caves, darker |
| Mantle | 140 m to core shell | 110 m to core shell | 3 (Sela) / 4 (Vorn) | Hot: oxygen drains 2x, rare ores |
| Core shell | 6 m thick around core chamber | same | 4 | Needs Drill Mk3 |
| Core chamber | center | center | n/a | Low gravity, glowing, ancient engine |

## Resources and items

All game data lives in JSON files under `src/data/`. Names here are the canonical IDs (lowercase snake_case in code).

| Item | Where | Use |
|---|---|---|
| Soil | Any digging (auto-collected into a soil counter, max 200) | Fill terrain with the tool |
| Resin | Surface nodes on both planets | Tethers, polymer |
| Silicate | Surface and crust nodes | Platforms, solar panels, printers |
| Ferrite ore | Crust nodes | Smelt into Iron |
| Cuprite ore | Crust and mantle nodes | Smelt into Copper |
| Lumen crystal | Crust walls (glows) | Light sticks, research |
| Biomass | Surface plants (Sela only) | Furnace fuel, shuttle fuel |
| Hydrite | Vorn surface ice | Shuttle fuel (alternative to Biomass) |
| Voidstone | Vorn mantle only | Sela engine activation |
| Heartglass | Sela core chamber only | Vorn engine activation |
| Iron, Copper, Polymer | Crafted | Advanced recipes |
| Research sample | Crust and mantle (glowing pods) | Gives Data at the research station |

## Crafting (initial recipe list, data-driven)

**Backpack printer** (always available): Tether (1 Resin), Light stick (1 Lumen crystal), Oxygen canister (1 Resin + 1 Silicate).

**Small printer** (placed on a platform): Platform (2 Silicate), Solar panel (1 Silicate + 1 Copper), Battery (1 Copper + 1 Silicate), Furnace (2 Silicate + 1 Ferrite ore), Research station (2 Silicate + 1 Lumen), Medium printer (2 Iron + 1 Silicate), Drill Mk2 (1 Iron + 1 Copper).

**Furnace** (needs power): Ferrite ore to Iron, Cuprite ore to Copper, Resin to Polymer.

**Medium printer**: Drill Mk3 (2 Iron + 2 Copper), Fuel refinery (2 Iron + 1 Copper), Shuttle (4 Iron + 2 Copper + 2 Polymer), Habitat kit (3 Iron + 2 Polymer, a new oxygen base for Vorn).

**Fuel refinery** (needs power): 2 Biomass or 1 Hydrite into 1 Fuel cell. A shuttle launch costs 2 Fuel cells.

Research gates: Start unlocked: Tether, Light stick, Oxygen canister, Platform, Small printer is pre-placed at base. Everything else costs Data at the research station.

## Survival rules

- Oxygen: 100 units, drains 1 per second off-network (multiplied by hazards). Refills fast inside tether range.
- Tether: range 12 m, connects to other tethers within 12 m, the network is "live" only if it connects back to a habitat.
- At 0 oxygen: screen fades, respawn at the last habitat, backpack items drop where you died (a marker shows them).
- No combat in v1.

## Power rules

- Habitat: +1 power/s permanent, small internal battery.
- Solar panel: +2 power/s scaled by sun angle, 0 at night or when the sun is blocked by the planet.
- Battery: stores 100 power.
- Consumers: furnace 2/s while working, printers 1/s while printing, refinery 3/s.
- Everything connected by cables placed between platforms (snap points). One network per connected graph.

## Endgame

Each core chamber holds an ancient engine with an activation socket. Sela's engine needs 3 Voidstone (from Vorn). Vorn's engine needs 3 Heartglass (from Sela's core). When both are active, a light beam connects the two planets and the credits roll. The player can keep playing afterwards.

## Controls (desktop only, v1)

| Key | Action |
|---|---|
| WASD | Move |
| Hold middle mouse | Look (pointer is free otherwise; right mouse is unbound) |
| Space | Jump / thrust up in jetpack-free low gravity / shuttle thrust |
| Shift | Sprint |
| Q | Equip / stow the terrain tool |
| Left mouse (tool on) | Use the selected brush |
| X (tool on) | Switch brush: dig <-> add |
| F (tool on) | Flatten mode |
| Ctrl+wheel (tool on) | Brush size |
| Left mouse (tool off) | Grab / release the item under the cursor (levitates it; release near a platform slot to place) |
| Drag backpack slot | Reorder / swap; drop outside the inventory to drop it into the world |
| C | Cable tool: click a snap, click a target; click a cabled snap to cut |
| Hold E | Pack up an empty machine/platform |
| E | Interact / pick up / enter shuttle |
| Tab | Backpack and printer UI |
| T | Place tether |
| L | Toggle headlamp |
| 1 to 8 | Select backpack slot |
| F1 | Debug overlay |
| F3 | Free-fly debug camera |
| F4 | Wireframe toggle |
| B | Show chunk bounds |
| Esc | Pause menu |

## Out of scope for v1

Multiplayer (planned later, architecture must allow it), rovers, more than two planets, planet rotation/orbits, combat, creatures, mobile/touch controls, voice or music beyond simple procedural sound effects.
