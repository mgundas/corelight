# Fix batch: review of 2026-11-12

You are fixing the findings in `docs/REVIEW-2026-11-12.md`. Read that file fully first, then `docs/ARCHITECTURE.md` (hard rules) and the "Decisions" section of `docs/PROGRESS.md`.

## Process (per finding)

Follow `prompts/FIX.md` for every finding:

1. Locate the cause in the cited code and state it in one or two sentences. Line numbers may have drifted; search by the symbol names given.
2. Make the smallest fix that addresses the root cause. Do not refactor unrelated code.
3. Add a unit test that fails before the fix and passes after, wherever the logic is testable. Tests must call the code the way production calls it (same argument shapes, e.g. pass a Map iterator if production does). Never weaken or delete an existing test.
4. Run `npm run check` from **PowerShell or cmd, not Git Bash**. Under Git Bash every suite fails with `reading 'config'`; that is an environment quirk, not a failure of your change.
5. Commit each finding separately: `fix: <short description>`. End the commit message with your usual attribution line, if you have one.

Findings marked **[likely]** or **[measured]** are not confirmed. Confirm them first (a quick probe or test). If one turns out not to be a bug, skip it and say so in your final report.

## Order

Do them in this order and stop to report if anything blocks you:

1. #1 items fall through unloaded ground (critical)
2. #2 canister burned on the network
3. #4 emptied chunk keeps its mesh
4. #5 worker retry with detached buffers (mesh pool and collider pool)
5. #6 save on quit + honest "Saved!"
6. #3 node identity stable across edits (keep `depletedNodes`/`nodeCharges` semantics; no save version bump unless the id format changes, and if it does, add a migration)
7. #7 cavern wrap discontinuity (keep every existing cavern/density test green; same seed must still give identical terrain)
8. #8 split `Game.ts` under 400 lines
9. Minors #9 to #16, smallest first. #15 (perf) only where the change is local and safe.

Do **not** change #17 (mining rate); it is a design question for the human.

## Hard constraints

- No three.js imports in `src/sim` or `src/terrain`.
- Gameplay state changes only inside `applyAction` or systems.
- No `any`, files under ~400 lines, magic numbers in `src/core/constants.ts`.
- Terrain must stay deterministic: same seed + same edits = identical density.

## When done

- Add one line per fix to `docs/PROGRESS.md` under "Decisions made during development", prefixed `Review 2026-11-12:`. List anything skipped or unresolved under "Known issues".
- Reply with:
  - a table of every finding (#1 to #17): fixed / skipped / not a bug, the commit hash and the test name
  - the final `npm run check` result
  - the manual browser checks from the review file that the human should run
