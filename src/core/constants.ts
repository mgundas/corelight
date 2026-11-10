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
