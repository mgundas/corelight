// Shared numeric constants. Magic numbers belong here, not inline.

/** Fixed simulation step in seconds (30 ticks per second). */
export const SIM_DT = 1 / 30;

/** Max sim ticks applied per rendered frame (caps spiral of death). */
export const MAX_TICKS_PER_FRAME = 5;

/** Camera distance from floating origin that triggers a shift. */
export const ORIGIN_SHIFT_DISTANCE = 1000;

/** Placeholder planet radius for the M00 scale sphere (Sela = 400 m). */
export const PLACEHOLDER_PLANET_RADIUS = 400;

/** Grid that floating-origin shifts snap to (keeps shifts stable). */
export const ORIGIN_SNAP_GRID = 32;

/** Default world seed when no ?seed= URL param is given. */
export const DEFAULT_SEED = 1337;

/** Terrain worker pool size: cores - 1, clamped (ARCHITECTURE.md). */
export const MESH_WORKER_MIN = 2;
export const MESH_WORKER_MAX = 6;

/** Max chunk meshes kept in the render cache before LRU eviction (M01: fixed set, headroom). */
export const CHUNK_CACHE_BUDGET = 1500;

/** Max empty chunk keys cached before aging out stale fine-grained ones. */
export const EMPTY_KEY_BUDGET = 2000;

/** Split a node when distance(camera, nodeCenter) < size * factor (ARCHITECTURE.md). */
export const LOD_SPLIT_FACTOR = 1.5;

/** Streaming desired-set recompute interval (diff + reprioritize at most this often). */
export const STREAM_UPDATE_INTERVAL_MS = 100;

/** Max main-thread time per frame spent applying finished mesh jobs. */
export const STREAM_APPLY_BUDGET_MS = 4;

/** Cap on mesh jobs in flight (keeps the pool queue short so reprioritizing works). */
export const STREAM_MAX_INFLIGHT_FACTOR = 2;

/** Priority bonus (meters) for chunks inside the view frustum. */
export const STREAM_FRUSTUM_BONUS = 300;

/** Low-poly detail for the M00 placeholder sphere (icosahedron subdivisions). */
export const PLACEHOLDER_SPHERE_DETAIL = 5;

/** Player capsule: total height 1.8 m, radius 0.35 m (M03). */
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.35;
/** Capsule half-height of the cylindrical middle: height / 2 - radius. */
export const PLAYER_HALF_HEIGHT = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;

/** Walk / sprint speeds in m/s (Astroneer-like, M03 feel). */
export const PLAYER_WALK_SPEED = 5;
export const PLAYER_SPRINT_SPEED = 8.5;
/** Takeoff velocity for jumps; floaty in the low-g core chamber. */
export const PLAYER_JUMP_SPEED = 4.5;

/** Steepest slope the character climbs instead of sliding (degrees). */
export const PLAYER_MAX_CLIMB_DEG = 50;
/** Slopes steeper than this always slide (degrees). */
export const PLAYER_MIN_SLIDE_DEG = 55;
/** Step offset for autostep (stairs, small rocks). */
export const PLAYER_STEP_HEIGHT = 0.3;
/** Snap-to-ground distance so downhill steps don't bounce. */
export const PLAYER_SNAP_DISTANCE = 0.5;
/** Small gap the character controller keeps from colliders. */
export const PLAYER_CONTROLLER_OFFSET = 0.02;

/** Terrain collider ring around the player (ARCHITECTURE.md). */
export const COLLIDER_RANGE_M = 48;

/** Spawn raymarch: start this far above the nominal surface, step inward. */
export const SPAWN_RAY_START_M = 200;
export const SPAWN_RAY_STEP_M = 1;
/** Capsule-center hover above the located surface point. */
export const SPAWN_HOVER_M = PLAYER_HALF_HEIGHT + PLAYER_RADIUS + 0.3;

/** Density at the capsule center that counts as "inside solid terrain". */
export const EMBED_DENSITY_THRESHOLD = 0.5;
/** Seconds embedded before the safety push-out kicks in. */
export const EMBED_GRACE_S = 1;
/** Push-out speed along the inverse density gradient. */
export const EMBED_PUSH_SPEED = 2;
