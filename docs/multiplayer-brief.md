# Multiplayer build brief

Game of Life is a co-operative climate-policy simulation. This brief covers the
multiplayer mode: 6 people, each holding one cabinet seat, playing the same
game live over the network. Read this in full before writing code — it covers
what already exists, what's deliberately deferred, and what's left to build.

## Agreed spec (do not re-litigate)

- Exactly 6 human players, one per portfolio seat (`energy`, `agriculture`,
  `treasury`, `foreign`, `environment`, `resilience`). No AI fallback for
  empty seats — all 6 must be human.
- No accounts. Identity is an anonymous per-browser token in `localStorage`
  (see `src/ui/net.ts` `getToken()`), reused across reloads so a refresh
  reclaims your seat instead of losing it.
- Only one game instance runs at a time — a single in-memory `Room`, no
  matchmaking, no multi-room registry, no database/persistence. If the
  server process restarts, the game is gone; that's accepted.
- Seat release is manual only — a player must explicitly leave their seat.
  No auto-timeout/kick for inactivity (agreed explicitly; a Phase-4 idea, not
  in scope unless asked for again).
- The round cannot advance until every claimed seat has committed moves for
  that round — hard gating, no partial resolution.
- Transport: a plain WebSocket server (`ws` npm package), not Cloudflare
  Durable Objects — chosen deliberately for simplicity over the DO/edge
  approach.

## Architecture

- `/src/engine` is the pure simulation (zero React, zero I/O) and must stay
  that way — this is what makes it reusable across the CLI (`src/sim/`), the
  solo browser UI (`src/ui/`), and the multiplayer server.
- `src/server/room.ts` — pure state machine (`Room` class), zero `ws`/Node
  dependency. This is intentional: both the server AND the browser client
  import types/logic from this file, so it must stay side-effect-free.
- `src/server/protocol.ts` — wire-protocol types (`InMessage`/`OutMessage`),
  deliberately separated from `index.ts` so client code never has to import
  `index.ts` (which starts a `WebSocketServer` as an import side effect).
- `src/server/index.ts` — the actual server process: one global `Room`
  instance, broadcasts full `RoomState` to all connected clients after every
  successful mutation. Includes a 20s ping/pong heartbeat (added after
  observing silent connection drops in production) that terminates dead
  sockets so the client's reconnect logic actually fires.
- `src/ui/net.ts` — client networking: `useRoom()` React hook, WebSocket
  lifecycle with fixed 1.5s reconnect, exposes `state`, `status`, `token`,
  `claimSeat`, `leaveSeat`, `commitMoves`.
- `src/ui/MultiplayerLobby.tsx` — live networked seat-picker. Fully working:
  connection status, name entry, live seat states (free / yours / taken),
  "N of 6 claimed" counter.

## What's already built and proven (do not redo)

1. **Seat claiming and gating** — proven via a scratch WS test client
   (`src/server/test-client.ts`, `npm run server:test`) and real dual-browser
   testing: claim conflicts rejected, round only resolves once all 6 commit,
   leaving a seat frees it and reverts phase to lobby.
2. **Deployment** — server is deployed to Fly.io (see `Dockerfile`,
   `fly.toml`, `.dockerignore`), one always-on machine (`min_machines_running
   = 1`, `auto_stop_machines = off`) because the `Room` is purely in-memory
   and would lose all state on a cold stop. The static UI is deployed
   separately to Cloudflare (`wrangler.jsonc`), built with `VITE_WS_URL`
   baked in at build time (`.env.production`) pointing at the Fly `wss://`
   endpoint.
3. **The lobby screen end-to-end**, live in production: 6 real players can
   connect, claim distinct seats, and the room correctly flips from `lobby`
   phase to `round` phase once the 6th seat is claimed.

## What's NOT built yet — this is the actual task

Right now, once all 6 seats are claimed, `MultiplayerLobby.tsx` just shows a
placeholder: *"GAME STARTING — round N. (The live gameplay screen lands in
the next build.)"* There is no networked gameplay yet. Two things are needed:

### 1. Wire the real engine into `Room`

`src/server/room.ts`'s `commitMoves()` currently accepts an opaque
`PendingMoves = unknown` and, once all 6 seats commit, calls a stub
`resolveRound()` that just increments a counter and clears the commit buffer.
This needs to become a real call into `/src/engine`, equivalent to whatever
the solo CLI/UI does per round (check `src/sim/play.ts` and `src/ui/session.ts`
for the existing single-player round-resolution flow — reuse that logic,
don't reimplement it). `RoomState` will need to grow to carry whatever the
resolved round produces (climate/political/death deltas, the "cabinet
reveals" beat, etc.) so the client has something to render.

### 2. Build the networked gameplay screen

The solo UI already has a full round experience: theatre/dashboard layout,
newsflash, policy selection with checkboxes, the "cabinet declares/reveals"
beat (colleagues' moves/lag/priority/hold-reasons, shown AFTER the player's
own move), forecast graphs, epilogue. The multiplayer version needs the same
experience, but:
- Policy selection sends a `commit-moves` message instead of resolving
  locally, then waits/shows who else hasn't committed yet.
- The "cabinet reveals" beat becomes real — it's actually showing the other
  5 humans' real committed moves, not AI-simulated ones.
- State is driven by `RoomState` broadcasts over `useRoom()`, not local
  component state.

Reuse the existing solo-mode components/CSS wherever the shape matches
rather than rebuilding from scratch — the visual language (checkboxes,
lag points, advisor briefing, charts) is already designed and should stay
consistent between solo and multiplayer.

## Known deferred items (do not do unless separately asked)

- Phase 4 polish: auto-timeout/kick for idle seats, illegal-move guards
  beyond what gating already prevents.
- Applying the Energy-style "self-healing policy" fix (added because Energy
  had no options that gained political points) to Foreign/Environment, if
  they have the same gap.
- Fixing `tsconfig.json`'s `include` (currently `src/**/*.ts` only, so
  `.tsx` files aren't type-checked by `tsc --noEmit`).

## Suggested approach

Given the size of this, gate it like the original engine build was gated:
confirm the plan (which parts of the solo round-resolution flow get reused
vs. adapted) before writing the networked gameplay screen, since that's the
larger and more subjective half of the work. The `Room`/engine wiring is more
mechanical and lower-risk to just build.
