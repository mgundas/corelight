# M16: Polish, audio and performance

## Goal
Make it feel like a finished game: sound, feedback, settings, and a performance pass.

## Tasks
1. Audio (`src/audio/`): procedural WebAudio sounds driven by sim events only (no audio calls from sim code): digging (filtered noise, pitch by layer hardness), item pickup/drop, printer working hum, tether placed, oxygen low warning beep, footsteps by surface, shuttle engine (pitch by thrust), wind on the surface fading underground, ambient cave drone deeper down. Master/music/effects volume.
2. Feedback: screen shake on shuttle launch, small particles when digging (using the layer color), item pickup pop, toast notifications style unified.
3. Settings menu: mouse sensitivity, invert Y, field of view, render distance (scales `LOD_SPLIT_FACTOR`), shadow quality (off/low/high), volume sliders. Saved to localStorage (wrapped in try/catch).
4. Performance pass. Measure and write the before/after numbers in PROGRESS.md:
   - Merge or instance repeated objects (nodes, tethers, plants) with `InstancedMesh`.
   - Check draw calls in the F1 overlay at the base and in space and reduce the top offenders.
   - Make sure geometry and materials are disposed when chunks and entities are removed (no memory growth over 10 minutes).
   - Profile worker meshing time per chunk and optimize the hottest loop (avoid allocations in marching cubes).
5. Bug sweep: play from new game to reaching Sela's mantle, list every bug you hit in PROGRESS.md "Known issues", fix the ones you can.
6. `npm run build` produces a working production build; document how to deploy it as static files.

## Acceptance criteria
- `npm run check` and `npm run build` pass.
- The game has sound for all core actions.
- Settings work and persist.
- FPS on the surface at the base is at least 60 on a mid-range PC with default settings (state your measurement).

## Finish
Update `docs/PROGRESS.md`. Commit: `M16: polish and performance`.
