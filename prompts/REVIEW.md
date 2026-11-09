# Review instructions

You are reviewing a milestone that another agent session just implemented. Do not edit files.

1. Read the milestone prompt, `docs/ARCHITECTURE.md` and `docs/PROGRESS.md`.
2. Run `npm run check` and report the result.
3. Look at the changes since the previous milestone commit (`git log --oneline` then `git diff <previous>..HEAD --stat` and the diffs of the main files).
4. Check every acceptance criterion: for each one, say "met", "not met" or "cannot verify without running the game", with the reason and file references.
5. Check the hard rules: three.js imports in `src/sim` or `src/terrain`, gameplay state mutated outside actions/systems, logic in the render loop, float32 positions in sim code, missing tests for new logic, files over 400 lines, `any` types, new dependencies not listed in ARCHITECTURE.md.
6. Look for common bugs in this kind of code: memory leaks (geometries/materials not disposed, listeners not removed), work on the main thread that belongs in a worker, per-frame allocations in hot loops, nondeterminism in terrain or node placement (Math.random instead of the seeded rng), single-planet assumptions.
7. Output a numbered list of problems ordered by severity (critical, major, minor), each with file path, line, what is wrong and a concrete fix. End with a list of manual test steps the human should do in the browser.
