# Game of Life

A co-operative game about trying to steer the climate with the political capital you can
actually spend. You are one seat in the cabinet of the **Climate Union** — a coalition of
roughly 30% of global emissions — over a twenty-year mandate. There is no winning: only how
many people die, and whether the next generation gets a chance. One counter sits above
everything, and it only ever rises. All you can do is change the slope.

## Architecture

- **`/src/engine`** — the pure simulation engine. No I/O, no side effects, no UI imports.
  Deterministic given a seed (single PRNG in `rng.ts`). The climate model, death-toll model,
  policy catalogue, pipeline, political health / succession, both decks, forecasts, AI
  ministers, and planetary targets all live here.
- **`/src/sim`** — the headless CLI: a batch runner, an interactive terminal game, and the
  demos used to build and tune each engine step.
- **`/src/ui`** — a React + Vite front end sitting on top of the engine, untouched. A staged
  "cabinet terminal": intro → per-round theatre (situation → world moves → your move →
  reckoning) over a live statistics dashboard → epilogue.

The design brief and design doc are in `/docs`.

## Running it

TypeScript runs directly on Node (native type stripping) — no build step for the engine/CLI.

```bash
npm install                         # first time (installs the UI's React/Vite deps)
node node_modules/esbuild/install.js  # once, if Vite complains about esbuild's binary

# the browser game
npm run dev                         # → http://localhost:5180

# the terminal game
npm run play                        # play a full game in the terminal

# the headless batch runner
npm run sim -- --games 1000         # outcome distribution, strategy comparison, channel
                                    #   breakdown, succession frequency, preventable moments,
                                    #   event influence
npm run sim -- --games 1 --verbose  # one game round-by-round, ending in the epilogue
```

## The shape of it

- **Political health is a resource, not a status bar** — it sets how many points you can
  spend, so a weakened minister literally cannot make bold moves. At zero you are replaced,
  not eliminated, by a successor shaped by how you fell.
- **Consequences arrive late** — policies land 1–6 rounds after you pay their political cost.
  The mandate's final decisions settle over four years, and the world is assessed in 2054.
- **You govern only 30%** — your domestic levers cut your own bloc; the free-riding rest of
  the world bends only to diplomacy. You cannot hit the climate targets alone.
- **Your choices change the odds, never the possibility** — the Events Deck is weighted by
  the state of the planet. You can play well and still draw the card that ends you.
