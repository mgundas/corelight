# How to build Corelight with OpenCode

This folder is the starting point of your repo. Copy everything into an empty project folder, then follow the steps below.

## What is in here

| File | Purpose |
|---|---|
| `opencode.json` | OpenCode config: Muse Spark 1.3 for everything, safe permissions, a `reviewer` agent and three commands |
| `AGENTS.md` | Rules OpenCode reads automatically in every session |
| `docs/PROJECT.md` | Game design: planets, layers, items, recipes, survival, controls |
| `docs/ARCHITECTURE.md` | Tech design and the hard rules the agent must follow |
| `docs/PROGRESS.md` | The agent updates this after each milestone so new sessions know what exists |
| `prompts/M00` to `M17` | One prompt per milestone |
| `prompts/REVIEW.md`, `prompts/FIX.md` | Review and bug-fix procedures |

## One-time setup

1. Create an empty folder, copy these files in, and open a terminal there.
2. Run `opencode`, then run `/models` and check the exact Muse Spark 1.3 ID. If it is not `opencode-go/muse-spark-1.3`, replace that string in `opencode.json` (it appears 5 times).
3. Install Node.js 20 or newer if you do not have it.

## The loop for every milestone

1. Start a **fresh OpenCode session** for each milestone (`/new`). Fresh context keeps the model sharp; the docs carry the memory.
2. Run `/milestone M00` (then M01, M02 and so on).
3. When it finishes, run `npm run dev` and do the manual checks in the milestone's "Acceptance criteria".
4. Run `/review M00` (this uses the reviewer agent, which cannot edit code).
5. Paste the review's critical and major problems back in a normal message, or use `/fix <problem>` for each bug you found yourself.
6. When it all works, make sure it is committed, then move to the next milestone.

## Milestone overview

| # | Milestone | What you can test afterwards |
|---|---|---|
| M00 | Scaffold | Fly a camera around a placeholder sphere |
| M01 | Density and meshing | A real planet with caves, layers and a hollow core |
| M02 | Streaming and LOD | Fly from space to the surface without holes or freezes |
| M03 | Gravity and player | Walk all the way around the planet, into caves |
| M04 | Terrain tool | Dig, build, flatten |
| M05 | Light and sky | Day/night, dark caves, headlamp, atmosphere |
| M06 | Save/load + checkpoint | Reload and continue; architecture audit |
| M07 | Resources and backpack | Mine nodes, carry items |
| M08 | Oxygen and tethers | Survival tension, respawn |
| M09 | Printing | Print tethers, platforms, light sticks |
| M10 | Base and power | Solar, batteries, cables |
| M11 | Research | Samples, Data, unlocks |
| M12 | Smelting and progression | Metals, drill upgrades, reach the core |
| M13 | Second planet and space | Fly to Vorn seamlessly (debug camera) |
| M14 | Shuttle | Real trip between planets |
| M15 | Cores and endgame | Activate both engines, ending |
| M16 | Polish | Sound, settings, performance |
| M17 | Co-op (optional) | Multiplayer, in several sessions |

## Tips for working with Muse Spark

- **M01 to M04 are the hardest milestones.** If one goes badly, do not keep patching. Run `git reset --hard` to the previous milestone commit and run the same milestone again in a fresh session. A clean second attempt usually beats ten fixes.
- If a milestone is too big for one session (the agent starts forgetting earlier steps), ask it to do only tasks 1 to 4 first, commit, then a new session for the rest.
- When you report a bug, describe what you see, what you expected, and the steps: "After digging down 20 m and walking into the hole, the player falls through the floor. Expected: stands on the floor."
- Use the F1 overlay numbers when reporting performance problems.
- Check the privacy terms for Muse Spark on the OpenCode Go page. At least one earlier Muse Spark variant on Go could use prompts for training, so do not put private keys or personal data in this repo.
