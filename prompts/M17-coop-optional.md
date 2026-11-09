# M17 (optional, later): Co-op multiplayer

Only start this after M16 is done and the single-player game is stable. Split it into several sessions; this prompt is the plan, ask the agent to do one step per session.

## Goal
2 to 4 players in the same world with an authoritative Node.js server, reusing the existing sim code.

## Steps (one per session)
1. **Server package**: create `server/` (Node + TypeScript) that imports `src/sim`, `src/terrain` and `src/planets` directly. Run the World tick at 30 Hz on the server with Rapier in Node. No three.js on the server (this proves the hard rules held).
2. **Transport**: WebSocket server (use `ws`, or Colyseus if you prefer rooms and matchmaking). Messages: client sends Actions; server sends snapshots (entity states in the serialized format from `src/save/`) at 15 Hz plus terrain edit events.
3. **Join flow**: a joining client receives the seed, the full edit set, research and entities, then streams terrain locally from seed + edits.
4. **Client prediction**: the local player's movement is predicted with the same character controller and corrected on server snapshots. Other players and items are interpolated between snapshots (100 ms buffer).
5. **Ownership**: the server simulates all dynamic bodies; the shuttle is simulated by the server with input from the pilot. Two players can ride the shuttle (pilot + passenger).
6. **UI**: host/join screen with a room code, player names, simple text chat.
7. **Persistence**: the server saves the world with the same serializer.

## Acceptance criteria
- Two browser tabs can join one world, see each other walk and dig, share a base and power, and fly the shuttle together.
- Single-player still works without a server.
