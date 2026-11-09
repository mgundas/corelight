// Shared numeric constants. Magic numbers belong here, not inline.

/** Fixed simulation step in seconds (30 ticks per second). */
export const SIM_DT = 1 / 30;

/** Max sim ticks applied per rendered frame (caps spiral of death). */
export const MAX_TICKS_PER_FRAME = 5;

/** Camera distance from floating origin that triggers a shift. */
export const ORIGIN_SHIFT_DISTANCE = 1000;

/** Placeholder planet radius for the M00 scale sphere (Sela = 400 m). */
export const PLACEHOLDER_PLANET_RADIUS = 400;
