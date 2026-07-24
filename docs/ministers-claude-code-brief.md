# Ministers — Simulation Engine Brief

**For Claude Code. Read the whole brief before writing anything.**

---

## What this is

The simulation engine for a co-operative climate policy game. Six ministerial portfolios, twelve rounds covering two years each, starting 2026. In the finished game one seat is a human and the rest are AI. In this build all six are scripted, and the game runs headlessly.

There is no win state. A game ends with a world state report and a ledger of what the cabinet traded away to get there.

**The purpose of this build is to find out whether the simulation is interesting.** Not whether it is playable, not whether it looks good. If the numbers move in ways that surprise and implicate, the design works and we build the game on top. If they do not, we find out cheaply.

There is no UI in this pass. See the out of scope section and take it literally.

---

## Stack and constraints

- **TypeScript, Node, no framework.** React and Vite come later, in a separate brief. Nothing in this build should import either.
- **Local only.** No backend, no server, no database. Run output written to disk as JSON.
- **No live data feeds.** Hardcode the canonical 2026 baseline. Put it behind a `loadOpeningState()` function returning a static object, so the live loader can be swapped in later without touching anything else.
- Deterministic given a seed. Every random draw goes through a single seeded PRNG, no bare `Math.random()` anywhere.

**Architecture requirement:** `/src/engine` is pure functions with no I/O and no side effects. `/src/sim` is the CLI runner that consumes it. This separation is not stylistic. The UI build will sit on top of the same engine untouched, and we will be running batches of thousands of games against it.

---

## Core loop

Each round:

1. **World phase.** Draw one World Deck card and roll the Events Deck.
2. **Budget.** Every minister receives points based on political health.
3. **AI declarations.** AI ministers state intent in plain language. Non binding.
4. **Player seat commitment.** The scripted player strategy spends points on policies at chosen severity tiers.
5. **AI commitment.** AI ministers commit. Revealed simultaneously with the player's.
6. **Resolution.** Political health adjusts. Planetary effects go onto the pipeline.
7. **Consequence.** Pipeline effects scheduled for this round land now. Metrics recalculate. Death toll updates.

---

## Data model

```ts
type PlanetState = {
  year: number
  tempAnomaly: number          // °C above pre-industrial
  co2: number                  // ppm
  annualEmissions: number      // GtCO2e
  methane: number              // ppb
  forestLossRate: number       // M ha/year
  wetlandRestored: number      // % vs baseline
  biodiversityIndex: number    // 0-100, 30 at baseline
  coralExtent: number          // % of 1990
  seaLevelRise: number         // cm cumulative
  oceanPh: number
  displacedAnnual: number      // millions/year
  displacedUnresettled: number // millions cumulative
  foodInsecure: number         // millions
  damagesPctGdp: number
  cumulativeDeaths: number     // only ever increases
}

type Minister = {
  id: PortfolioId
  portfolio: 'energy' | 'agriculture' | 'treasury' | 'foreign' | 'environment' | 'resilience'
  doctrine: 'accelerationist' | 'guardian' | 'dealmaker' | 'populist'
  politicalHealth: number      // 0-10
  isPlayer: boolean
  generation: number           // 1 = original, increments on succession
  restrictions: Restriction[]  // active menu locks from succession
  forecast: ForecastModel
}

type Policy = {
  id: string
  name: string
  domain: PortfolioId
  tiers: [PolicyTier, PolicyTier, PolicyTier]  // light, moderate, aggressive
}

type PolicyTier = {
  severity: 'light' | 'moderate' | 'aggressive'
  pointCost: number
  lag: number                        // 1-6 rounds
  effects: Partial<PlanetState>      // deltas applied on landing
  politicalCost: PoliticalCost       // immediate, by portfolio
  locksIn: boolean
  upkeep?: number                    // points/round if it decays
}

type PipelineEntry = {
  policyId: string
  severity: string
  enactedRound: number
  landsRound: number
  enactedBy: PortfolioId
  enactedByGeneration: number
  effects: Partial<PlanetState>
}
```

---

## The death toll model

**This is the hardest and most important part of the build. Do this first, before any UI.**

The counter must be traceable. At the end, the game needs to name the specific round where the cabinet traded lives for trajectory. That means deaths are never a single opaque formula. They are the sum of named channels, each logged every round.

```ts
type DeathChannel = 'heat' | 'food' | 'displacement' | 'disaster' | 'conflict'
```

Per round, calculate deaths per channel:

**Heat.** Non-linear in temperature anomaly. Roughly flat below 1.4°C, rising sharply above 1.6°C. Reduced by cumulative adaptation investment.

**Food.** Scales with `foodInsecure` above a threshold. This is the channel most responsive to policy, and the one most often sacrificed for emissions progress. Make sure it is sensitive enough to notice.

**Displacement.** Scales with `displacedUnresettled`, not `displacedAnnual`. People die from not being resettled, not from moving. Reduced by resilience spending.

**Disaster.** Driven by Events Deck draws. Magnitude reduced by adaptation and resilience policy already landed. This is where "we should have built the flood defences" shows up.

**Conflict.** Scales with political instability combined with resource stress (food plus water). Slow burning, hard to reverse once it starts.

Every round, write a `DeathLedgerEntry`:

```ts
type DeathLedgerEntry = {
  round: number
  byChannel: Record<DeathChannel, number>
  total: number
  drivers: string[]      // e.g. "food insecurity rose 6% following carbon price"
  preventable: {         // could this have been reduced this round?
    channel: DeathChannel
    availablePolicy: string
    pointsRequired: number
    cabinetPointsUnspent: number
  }[]
}
```

The `preventable` array is what makes the epilogue land. If the cabinet had spare points and a policy on the menu that would have cut a channel, record it. The epilogue reads that ledger back.

**Do not add a "lives saved" counter anywhere.** One number, always rising.

---

## The two decks

**World Deck.** Responsive. Weight draws by current game state, not a fixed schedule. If coalition cohesion is low, weight toward defection, obstruction and election loss cards. If the cabinet is stable and credible, weight toward diplomacy openings and compliance offers.

Roughly 25 cards for this build. Political and economic only.

**Events Deck.** Physical shocks and feedback loops. **Weight by planetary state, not flat random.**

```ts
function drawProbability(card: EventCard, planet: PlanetState): number
```

The Siberian methane card sits at low odds at +1.4°C and roughly triples by +1.8°C. Same treatment for AMOC disruption, Amazon dieback, West Antarctic collapse, monsoon failure, wet bulb events, regional crop failure.

Roughly 15 cards for this build.

**Feedback loop cards must be able to modify the pipeline retroactively.** A methane release shortens every remaining lag window by 1. Policies placed at lag 5 now arrive too late to matter. Implement this properly, it is one of the best things in the design.

---

## Political health and succession

Health 0 to 10. Points per round: 5 at 8-10, 4 at 5-7, 3 at 3-4, 2 at 1-2.

**Losing health:** consumer price rises, livelihood removal, being in office when a shock hits your domain, visible association with another minister's unpopular win.

**Regaining health:** relief and adaptation policy (which trades planetary progress for political recovery), pipeline effects landing and being correctly attributed, a round spent doing nothing, a favourable event in your domain.

**At zero: succession, never elimination.** Same portfolio, new person, `generation` increments. The successor type is determined by the cause of the fall:

| Cause of fall | Successor | Restriction |
|---|---|---|
| Price anger | Populist | Cannot raise consumer costs, 3 rounds |
| Unprepared for domain disaster | Technocrat | Cheap adaptation, starts at health 3 |
| Coalition dirty work | Nationalist | Cannot spend internationally, 3 rounds |
| Job losses | Protectionist | Cannot touch employment, 3 rounds |

Succession also costs: one transition round at reduced points, and all informal deals void. Locked in policy survives, promises do not.

**The files.** On succession the player sees their predecessor's forecast, and a note on whether it turned out accurate so far. If the player is inheriting from themselves, this can be brutal.

---

## Forecasts

Six models, one per minister. They disagree materially on feedback loop timing, displacement projections, locked in warming, and ice loss rates.

One model is significantly more accurate. Assign randomly at game start. **Do not surface which.**

Confidence intervals narrow each round. Accuracy becomes inferable as events confirm or contradict each model, but only from around round eight, which is after the cheap decisions are gone.

The epilogue names the accurate model explicitly, along with what happened to the minister who held it.

---

## AI ministers

Keep this simple. Do not use an LLM.

Each AI minister acts on:
- Their doctrine (what is discounted for them)
- Their forecast (which may be wrong, and they act on it as if true)
- Their political health (self preservation increases sharply below 4)
- Their portfolio's exposure

They should be capable of **refusing to take the hit.** An AI minister at health 3 who is asked to enact aggressive methane policy should decline and say so. That refusal is the game.

AI declarations in phase 3 should be short plain-language lines. Templated is fine.

> *"Agriculture: I am at 3. If I take methane aggressive I fall, and you get a populist who cannot touch livestock for three rounds. Someone else finds the points or we do it light."*

---

## The simulation runner

**This is the deliverable.** No UI in this pass.

```
npm run sim -- --games 1000 --seed 42
```

It should support:
- `--games N` for batch runs
- `--seed` for reproducibility
- `--verbose` to print a single full game round by round, so a human can read what happened
- `--player-strategy <name>` to swap the strategy standing in for the human player

Since there is no human in the loop, the player seat is filled by a scripted strategy. Implement at least four, because comparing them is how we find out whether choices matter:

| Strategy | Behaviour |
|---|---|
| `maximiser` | Always the deepest emissions cut available, ignores political cost |
| `survivor` | Never drops below health 5, takes light tiers only |
| `balancer` | Alternates hard rounds and relief rounds |
| `random` | Legal moves at random, as a control |

### What a batch run must report

**Outcome distribution.** Final death toll across all games: min, max, median, and the shape of the spread. Same for peak temperature and final emissions.

**Strategy comparison.** Death toll by player strategy. If `random` performs comparably to `maximiser`, choices are not mattering and the design is broken.

**Channel breakdown.** Which death channels dominate, and how that shifts between strategies. If one channel swamps the others in every game, it needs retuning.

**Succession frequency.** How many ministers fall per game, when, and which portfolios. If Agriculture falls in round three of every game, the political cost model is wrong.

**Preventable moments.** Average count per game of rounds where the cabinet had unspent points and an available policy that would have cut a death channel. If this is near zero, the epilogue has nothing to say.

**Event influence.** Correlation between Events Deck draws and final outcome. Some influence is the point. Total dominance means the player is a passenger.

### What we are looking for

An enormous spread between best and worst available outcomes, with none of them good.

If a thousand games land in a narrow band, the premise is dead and we find out now rather than after building a front end for it.

---

## Build order

1. Engine types and canonical 2026 state
2. Policy catalogue (aim for 18 to 24 policies across six domains, three tiers each)
3. Death toll model and ledger
4. Pipeline
5. Political health, succession, restrictions
6. Both decks with weighted draw
7. AI minister decision logic
8. Scripted player strategies
9. Simulation runner and reporting

Work in that order. Each step should be usable from a script before moving to the next.

---

## Explicitly out of scope

- **All UI.** No React, no Vite dev server, no components. This pass is engine and CLI only. Do not build a front end, do not build a "quick visualisation," do not add a browser preview.
- Multiplayer, server, accounts
- Live planetary data feeds
- LLM-driven AI ministers
- Persistence beyond writing run output to disk

If the engine proves interesting, the UI gets its own brief.

---

## Definition of done

`npm run sim -- --games 1000` completes and prints a report covering outcome distribution, strategy comparison, channel breakdown, succession frequency, preventable moments, and event influence.

`npm run sim -- --games 1 --verbose` prints a single game round by round, readable by a human, ending in the full epilogue text including the named preventable moment and the forecast reveal.

That second one is the real test. If the verbose output of one game reads as a story worth telling, the design works.
