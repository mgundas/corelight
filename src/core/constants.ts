// Shared numeric constants. Magic numbers belong here, not inline.

/** Fixed simulation step in seconds (30 ticks per second). */
export const SIM_DT = 1 / 30;

/** Max sim ticks applied per rendered frame (caps spiral of death). */
export const MAX_TICKS_PER_FRAME = 5;

/** Render-only camera recovery; inward collision response stays immediate. */
export const CAMERA_RECOVERY_RATE = 8;
export const CAMERA_LOOK_RADIANS_PER_PIXEL = 0.0025;
export const CAMERA_FOCUS_HEIGHT = 0.45;
export const SHADOW_MAP_SIZE_LOW = 1024;
export const AVATAR_STRIDE_M = 2.2;
export const AVATAR_LIMB_SWING = 0.4;
export const AVATAR_TELEPORT_DISTANCE_SQ = 25;

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

/** Overall priority bonus (meters) for chunks inside the view frustum. */
export const STREAM_FRUSTUM_BONUS = 300;

/** Levels a non-primary planet may drop below lodMaxLevel while far away
 * (M13): the boot prebuilt L(max-2)..L(max) is the far planet's detail floor. */
export const FAR_PLANET_LOD_DROP = 2;

/** Hysteresis for the current-planet choice (M13): a challenger must be
 * closer by more than this before the LOD/fog primary flips, so the swap
 * cannot flap at the exact midpoint between two planets. */
export const PRIMARY_PLANET_HYSTERESIS_M = 200;

/** Self-illumination of the far planet (M13): the one sun lights it during
 * the shared day, but the local night fade would leave it black. A dim
 * emissive glow keeps it readable as a lit sphere without lighting cave
 * ceilings on the player's own planet (see lighting.ts). */
export const FAR_PLANET_EMISSIVE = 0.14;

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
export const TOOL_RANGE_M = 24;
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
/** Drill tier hardness (M12): layers with hardness above this are skipped.
 * Mk1 is the starting terrain tool; Mk2/Mk3 are backpack drill items. */
export const DRILL_MK1_HARDNESS = 2;
export const DRILL_MK2_HARDNESS = 3;
export const DRILL_MK3_HARDNESS = 4;
/** Mk3 digs 30% faster (PROJECT.md M12): stroke strength multiplier. */
export const DRILL_MK3_SPEED_MULT = 1.3;
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
export const FOG_SPACE_START_M = 30;
/** Altitude where fog is gone (distant planet stays crisp). */
export const FOG_SPACE_END_M = 120;
/** Altitude where the sky background starts fading to black (space). */
export const SKY_SPACE_START_M = 30;
/** Altitude where the fade to black is complete. */
export const SKY_SPACE_END_M = 120;

/** Scattering is integrated in planet-scaled meters; optical depths are
 * dimensionless so the same shader works on both small planets. */
export const ATMOSPHERE = {
  referenceHeight: 60, scaleHeightFraction: 0.08,
  rayleighOpticalDepth: [0.065, 0.14, 0.32] as const,
  mieOpticalDepth: 0.018, mieScaleHeightFraction: 0.4,
  mieAnisotropy: 0.76, sunIntensity: 8,
  viewSamples: 16, sunSamples: 6,
  sphereSegments: 96, sphereRings: 64,
  orbitFadeStartHeight: 1, orbitFadeEndHeight: 2,
} as const;

/** Headlamp spotlight tuning (SpotLight attached to the camera). */
export const HEADLAMP_COLOR = 0xfff1d6;
export const HEADLAMP_INTENSITY = 18;
export const HEADLAMP_DISTANCE = 90;
export const HEADLAMP_ANGLE = 0.58;
export const HEADLAMP_PENUMBRA = 0.85;
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
/** Vorn surface cold multiplies off-network drain (PROJECT.md: 1.5x).
 * Mantle heat (2x) is planet-config data (`LayerConfig.hazardOxygenMult`). */
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
/** Forgiving cursor margin around the catalog building body. */
export const STRUCTURE_PICK_MARGIN_M = 0.15;
/** Station input slots: the largest recipe (shuttle) needs 8 item units. */
export const STATION_INPUT_SLOTS = 8;
/** Furnace (M12): one recipe input slot plus one optional biomass fuel slot. */
export const FURNACE_INPUT_SLOTS = 2;
/** Biomass fuel advances a smelt job at this multiple of normal speed. */
export const FUEL_BOOST_MULT = 2;
/** Open printer panel refresh interval (ms): progress is decisecond-granular
 * and counts change on actions, so 10 Hz is plenty and avoids per-frame
 * state/string allocation. */
export const PRINTER_UI_SYNC_INTERVAL_MS = 100;
/** Large front-carried items slow movement to this multiplier (30% slower). */
export const CARRY_SLOW_MULT = 0.7;
/** Placement rejects ground whose normal is more than this off local up. */
export const PLACE_MAX_SLOPE_DEG = 20;
/** Structure placement reach stays independent of the longer terrain beam (m). */
export const PLACE_RANGE_M = 7.5;
/** Live density at the ghost must be near the surface (abs density <= this). */
export const PLACE_SURFACE_TOLERANCE = 0.6;

/** Base power (M10). Habitat generation and solar peak (power/s). */
export const POWER_HABITAT_GEN = 1;
export const POWER_SOLAR_GEN = 2;
/** Storage capacities (power units). */
export const BATTERY_CAPACITY = 100;
export const HABITAT_CAPACITY = 20;
/** Look range for the HUD power readout (m). */
export const POWER_VIEW_RANGE_M = 6;

/** Cable tool (M10): max cable length and player-to-snap reach (m). */
export const CABLE_MAX_LENGTH_M = 10;
export const CABLE_REACH_M = 10;
/** Ray-to-snap pick radius for cable clicks and placement snapping (m). */
export const CABLE_SNAP_RADIUS_M = 1.5;
export const SNAP_PLACE_RADIUS_M = 2;
/** Hold E this long on an empty machine/platform to pack it up (ms). */
export const PACK_HOLD_MS = 1000;

/** Grab-carry (cursor mode): click range and hold distance in front. */
export const GRAB_RANGE_M = 4;
export const GRAB_DISTANCE_M = 2.2;
/** Lift the grabbed item slightly above the aim line (Astroneer feel). */
export const GRAB_LEVITATE_M = 0.35;
/** Max distance a released item may land from the player (m). */
export const GRAB_RELEASE_RANGE_M = PLACE_RANGE_M;

/** Research samples (M11): deterministic cave pods, rarer than nodes. */
export const SAMPLE_SPAWN_RANGE_M = 96;
export const SAMPLE_DESPAWN_RANGE_M = 140;
/** Per-chunk chance for an eligible chunk (crust / mantle). */
export const SAMPLE_CRUST_CHANCE = 1 / 6;
export const SAMPLE_MANTLE_CHANCE = 1 / 3;
/** Data value by origin depth (PROJECT.md: crust 10, mantle 20, core 40). */
export const SAMPLE_VALUE_SURFACE = 10;
export const SAMPLE_VALUE_CRUST = 10;
export const SAMPLE_VALUE_MANTLE = 20;
export const SAMPLE_VALUE_CORE = 40;
/** Research station processing (PROJECT.md: 20 s at 1 power/s). */
export const RESEARCH_TIME_S = 20;
export const RESEARCH_POWER = 1;
/** Open research panel refresh interval (ms), same rationale as printers. */
export const RESEARCH_UI_SYNC_INTERVAL_MS = 100;
/** Flight HUD projection interval (ms): planet/base bearings are stable at
 * this rate and the panel need not walk every entity at display rate. */
export const FLIGHT_UI_SYNC_INTERVAL_MS = 100;
/** How long the "New blueprint" toast stays visible (ms). */
export const TOAST_DURATION_MS = 3200;

/** Shuttle (M14). Arcade flight: gravity inside an SOI, free drift in space. */
export const SHUTTLE_FUEL_MAX = 2;
/** Launch needs a full pair of fuel cells and a held Space press. */
export const SHUTTLE_LAUNCH_HOLD_S = 2;
/** Upward kick at launch so the shuttle clears its own landing legs. */
export const SHUTTLE_LAUNCH_SPEED = 40;
/** Near-surface speed cap; grows toward the space cap with altitude. */
export const SHUTTLE_MAX_SPEED_SURFACE = 120;
/** Cruise cap in space without Shift. */
export const SHUTTLE_SPACE_CRUISE_SPEED = 300;
/** Space cap with Shift (PROJECT.md trip: ~30-60 s between planets). */
export const SHUTTLE_MAX_SPEED_SPACE = 600;
/** Surface cap multiplier while boosting inside an SOI. */
export const SHUTTLE_BOOST_MULT = 1.25;
/** Altitude over which the surface cap scales to the space cap (m). */
export const SHUTTLE_SPEED_RAMP_M = 400;
export const SHUTTLE_THRUST_ACCEL = 30;
export const SHUTTLE_LIFT_ACCEL = 35;
/** A/D yaw rate (rad/s) and mouse pitch clamp. */
export const SHUTTLE_YAW_RATE = 1.5;
export const SHUTTLE_PITCH_LIMIT = 1;
/** Below this altitude the landing assist clamps descent and levels out. */
export const SHUTTLE_LANDING_ASSIST_M = 40;
/** If the ground probe misses below this altitude, the ring is still loading:
 * clamp speed so the ship cannot outrun collider streaming into a hill. */
export const SHUTTLE_TERRAIN_PENDING_ALTITUDE_M = 80;
export const SHUTTLE_ASSIST_DESCENT_MPS = 4;
/** Horizontal cap during the landing assist so a dive cannot overshoot. */
export const SHUTTLE_ASSIST_SPEED_MPS = 40;
/** Touchdown at or below this descent speed is safe. */
export const SHUTTLE_SAFE_TOUCHDOWN_MPS = 6;
/** Fraction of the impact speed kept when a hard touchdown bounces. */
export const SHUTTLE_BOUNCE_DAMP = 0.35;
/** Landing legs hold the origin this far above the terrain. */
export const SHUTTLE_GROUND_CLEARANCE_M = 0.15;
/** E board/load range from the shuttle base. */
export const SHUTTLE_ENTER_RANGE_M = 4.5;
/** E exit is allowed below this speed (and only while landed). */
export const SHUTTLE_EXIT_SPEED_MPS = 1;
/** Cone half-angle for the on-foot shuttle pick (no cursor ray). */
export const SHUTTLE_AIM_DEG = 35;
/** Chase camera distance/height behind the shuttle. */
export const SHUTTLE_CHASE_DISTANCE_M = 10;
export const SHUTTLE_CHASE_HEIGHT_M = 3;
/** Auto-orient rate (1/s) when the shuttle enters a planet SOI. */
export const SHUTTLE_AUTO_ORIENT_RATE = 3;
