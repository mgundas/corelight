# Instructions for coding agents

You are building **Corelight**, a browser-based Astroneer-like game. Three files define the project and are loaded into your context automatically:

- `docs/PROJECT.md`: what the game is (design, content, rules)
- `docs/ARCHITECTURE.md`: how it is built, including **hard rules** you must follow
- `docs/PROGRESS.md`: what is already built

Work is split into milestones. Each milestone has a prompt in `prompts/Mxx-*.md`. Only work on the milestone you were asked to do.

## How to work

1. Read the milestone prompt fully before writing code.
2. Look at the existing code before adding new code. Reuse existing modules; do not create parallel versions of things that already exist.
3. Work in small steps. After each step run `npm run check` and fix errors before continuing.
4. Never weaken or delete a test to make it pass. Fix the code.
5. If something in the prompt is impossible or conflicts with ARCHITECTURE.md, say so clearly, choose the simplest approach that respects the hard rules, and write the decision in `docs/PROGRESS.md` under "Decisions".
6. At the end: make sure every acceptance criterion is met, update `docs/PROGRESS.md`, and commit.

## Style

- TypeScript strict, no `any`, small focused files (under ~400 lines).
- Name things clearly; prefer plain functions and plain data over class hierarchies in `src/sim/`.
- Comments explain WHY, not what.
- Magic numbers go into `src/core/constants.ts` or the planet config.
