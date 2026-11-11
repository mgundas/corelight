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
/** Embedded seconds before giving up on gradient descent and plowing steadily
 * toward the surface (escapes flat valley floors that sit above threshold). */
export const EMBED_ESCAPE_S = 4;
/** Surface-ward escape plow speed in m/s (safety net only; overshoot into a
 * cave just frees the player sooner). */
export const EMBED_ESCAPE_SPEED = 50;

/** Soil counter cap (PROJECT.md: max 200; add mode consumes it). */
export const SOIL_MAX = 200;
/** Terrain tool range in meters (tool hit must be this close to work). */
export const TOOL_RANGE_M = 6;
/** Slack on the sim-side range check: the aim is measured from the
 * astronaut's head (HEAD_HEIGHT above the capsule center), so a max-range
 * downward stroke lands slightly farther from the feet. */
export const TOOL_RANGE_SLACK_M = 1.5;
/** Tool brush radius limits in meters (Ctrl+wheel adjusts). */
export const TOOL_MIN_RADIUS = 1;
export const TOOL_MAX_RADIUS = 4;
export const TOOL_DEFAULT_RADIUS = 2;
/** Held-button edit rate: one terrainEdit action per this many seconds. */
export const TOOL_EDITS_PER_SECOND = 10;
/** Density delta applied at the brush center per edit (quadratic falloff). */
export const TOOL_DIG_STRENGTH = 0.5;
/** How long the "Too hard" indicator stays visible after a blocked dig. */
export const TOO_HARD_INDICATOR_S = 1.5;

/** Full day/night cycle in seconds (ARCHITECTURE.md: 12 minute period). */
export const DAY_LENGTH_S = 12 * 60;

/** Depth below the surface where caves are fully dark (ambient floor). */
export const DEPTH_FULL_DARK_M = 25;
/** Hemisphere/ambient scale at the surface vs deep underground (ARCHITECTURE.md). */
export const AMBIENT_SURFACE = 1.0;
export const AMBIENT_DEEP = 0.08;

/** Shadow frustum side length in meters (single cascade around the player). */
export const SHADOW_FRUSTUM_M = 64;
/** Shadow map resolution (one 2048 cascade; near chunks only). */
export const SHADOW_MAP_SIZE = 2048;

/** FogExp2 density at the surface, deep underground, and in space. */
export const FOG_SURFACE_DENSITY = 0.0011;
export const FOG_CAVE_DENSITY = 0.028;
/** Altitude where fog starts fading out toward space. */
export const FOG_SPACE_START_M = 400;
/** Altitude where fog is gone (distant planet stays crisp). */
export const FOG_SPACE_END_M = 2000;
/** Altitude where the sky background starts fading to black (space). */
export const SKY_SPACE_START_M = 400;
/** Altitude where the fade to black is complete. */
export const SKY_SPACE_END_M = 2000;

/** Atmosphere shell radius as a multiple of the planet radius. */
export const ATMOSPHERE_SHELL_MULT = 1.35;

/** Headlamp spotlight tuning (SpotLight attached to the camera). */
export const HEADLAMP_COLOR = 0xfff1d6;
export const HEADLAMP_INTENSITY = 60;
export const HEADLAMP_DISTANCE = 90;
export const HEADLAMP_ANGLE = 0.46;
export const HEADLAMP_PENUMBRA = 0.5;
export const HEADLAMP_DECAY = 1.2;

/** Max entries in the module-level seeded-noise cache (density.ts).
 * One session holds ~7 per world-seed x planet; 64 covers several
 * New Game / Continue cycles before the oldest entry is rebuilt. */
export const NOISE_CACHE_BUDGET = 64;

/** Half-width of the cavern wrap guard: within this distance of a floor
 * boundary the rooms pinch shut and the ground reads as slab. The room mask
 * and anchor pockets are per-floor noise (indexed by roomIdx), so the raw
 * term jumps at every wrap; the guard forces both sides strongly solid so
 * the min() never selects it there and no phantom ceiling appears. Kept to
 * 2 m so room interiors (14 m tall, anchors at mid-room) stay open. */
export const CAVERN_WRAP_GUARD_M = 2;

/** Backpack slots per player (PROJECT.md: 8, one item per slot in v1). */
export const BACKPACK_SLOTS = 8;
/** Pick-up range: E grabs the aimed item this close to the player. */
export const PICKUP_RANGE_M = 3;
/** Node streaming: spawn deterministic nodes in LOD0 chunks this near. */
export const NODE_SPAWN_RANGE_M = 96;
/** Nodes past this distance are removed (re-spawned on return, unless depleted). */
export const NODE_DESPAWN_RANGE_M = 140;
/** Charges per fresh node (deterministic 2 to 5 per chunk + seed). */
export const NODE_MIN_CHARGES = 2;
export const NODE_MAX_CHARGES = 5;
/** Item physics body radius (Rapier ball, spherical gravity). */
export const ITEM_BODY_RADIUS = 0.25;
/** Max active point lights for glowing items (ARCHITECTURE.md budget). */
export const ITEM_LIGHT_BUDGET = 12;

/** Tether link range: tethers connect to habitats/others within this (m). */
export const TETHER_RANGE_M = 12;
/** Oxygen radius around a live tether or habitat (m, PROJECT.md/M08). */
export const OXYGEN_RANGE_M = 12;
/** Player oxygen 0..OXYGEN_MAX (100 units, 1/s drain off-network). */
export const OXYGEN_MAX = 100;
/** Oxygen refill per second inside a live network. */
export const OXYGEN_REFILL_PER_S = 20;
/** Oxygen drain per second off-network (before hazard multipliers). */
export const OXYGEN_DRAIN_PER_S = 1;
/** Mantle heat multiplies off-network oxygen drain (PROJECT.md: 2x). */
export const OXYGEN_MANTLE_MULT = 2;
/** Vorn surface cold multiplies off-network drain (PROJECT.md: 1.5x). */
export const OXYGEN_VORN_COLD_MULT = 1.5;
/** Oxygen at/below which a carried canister auto-refills to full. */
export const OXYGEN_CANISTER_THRESHOLD = 20;
/** Habitat flatten radius at spawn (m). */
export const HABITAT_FLATTEN_RADIUS_M = 14;
/** Lateral offset of the habitat from the player spawn (m). */
export const HABITAT_SPAWN_OFFSET_M = 8;
/** Max drop distance for the tether ground-seat raymarch (m). */
export const TETHER_GROUND_SEARCH_M = 6;
/** Raymarch start height above the seat anchor (m, clears overhangs). */
export const TETHER_SEAT_TOP_M = 6;
/** How far ahead of the player a new post lands (m). Seating it under the
 * feet hides it inside the astronaut; ahead keeps it visible and out of
 * the capsule. Deviation from the prompt's "under the player", documented. */
export const TETHER_PLACE_AHEAD_M = 1.5;

/** Station interaction range: E opens/deposits/collects within this (m). */
export const STATION_RANGE_M = 4.5;
/** Station input slots: the largest recipe (shuttle) needs 8 item units. */
export const STATION_INPUT_SLOTS = 8;
/** M09 temporary power flag: stations run without a power network until M10
 * wires the real system. M10 deletes this constant and the `if` it guards. */
export const CRAFTING_REQUIRE_POWER = false;
/** Large front-carried items slow movement to this multiplier (30% slower). */
export const CARRY_SLOW_MULT = 0.7;
/** Placement rejects ground whose normal is more than this off local up. */
export const PLACE_MAX_SLOPE_DEG = 20;
/** Placement must be within tool reach of the player (m). */
export const PLACE_RANGE_M = TOOL_RANGE_M + TOOL_RANGE_SLACK_M;
/** Live density at the ghost must be near the surface (abs density <= this). */
export const PLACE_SURFACE_TOLERANCE = 0.6;
