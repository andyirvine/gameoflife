// Step-6 decks demo.
//
// Demonstrates the two decks and, above all, that the draws are WEIGHTED BY STATE rather
// than flat random — the core requirement of the brief.
//
//   node src/sim/decks-demo.ts [scenario]
//
// Sections:
//   A. Events Deck draw probabilities across temperature (the odds triple as it warms).
//   B. Aggregate: expected events per round cool vs hot; World Deck tone shifting with the
//      cabinet's cohesion.
//   C. A live composed game (climate + pipeline + both decks + political + deaths) for one
//      seed, round by round, so you can read the world reacting to the state.

import { loadOpeningState } from '../engine/opening-state.ts'
import { stepClimate, initAccumulators } from '../engine/climate.ts'
import { initStocks, stepStocks } from '../engine/stocks.ts'
import { initDeathModel, resolveDeaths, type DeathContext } from '../engine/death.ts'
import { getPolicy } from '../engine/policies.ts'
import { initPipeline, enact, landDue } from '../engine/pipeline.ts'
import {
  initCabinet, resolveRound, isLegalFor, cabinetInstability, ministerOf,
  type Committed, type ExternalPolitical,
} from '../engine/political.ts'
import {
  EVENTS_DECK, drawProbability, rollEvents, applyEvents, combineShocks,
} from '../engine/events-deck.ts'
import { WORLD_DECK, worldCardWeight, drawWorldCard } from '../engine/world-deck.ts'
import { makeRng } from '../engine/rng.ts'
import type { PlanetState, PortfolioId } from '../engine/types.ts'
import { SCENARIOS, type Scenario } from './scenarios.ts'

const CODE: Record<PortfolioId, string> = {
  energy: 'ENE', agriculture: 'AGR', treasury: 'TRE',
  foreign: 'FOR', environment: 'ENV', resilience: 'RES',
}

function planetAtTemp(temp: number): PlanetState {
  return { ...loadOpeningState(), tempAnomaly: temp }
}

// --- A. Draw-probability table ---
function sectionA() {
  console.log('\n=== A. Events Deck: draw probability by temperature ===')
  console.log('(other state held at 2026 baseline; the odds triple roughly every 0.4°C)\n')
  const temps = [1.3, 1.5, 1.7, 1.9, 2.1]
  const show = ['siberian-methane', 'wet-bulb-event', 'monsoon-failure', 'ice-sheet-instability', 'tipping-cascade']
  console.log('card                         ' + temps.map((t) => `${t.toFixed(1)}°C`.padStart(8)).join(''))
  console.log('─'.repeat(30 + temps.length * 8))
  for (const id of show) {
    const card = EVENTS_DECK.find((c) => c.id === id)!
    const row = temps.map((t) => `${(drawProbability(card, planetAtTemp(t)) * 100).toFixed(1)}%`.padStart(8)).join('')
    console.log(card.name.padEnd(29) + row)
  }
}

// --- B. Aggregate frequency + tone shift ---
function sectionB() {
  console.log('\n\n=== B. Weighted draw, aggregated ===\n')
  const N = 4000
  console.log('Expected Events Deck cards fired per round (avg over 4000 rolls):')
  for (const t of [1.3, 1.5, 1.7, 1.9]) {
    const rng = makeRng(0xbeef ^ Math.round(t * 100))
    let total = 0
    const planet = planetAtTemp(t)
    for (let i = 0; i < N; i++) total += rollEvents(planet, rng).length
    console.log(`  ${t.toFixed(1)}°C : ${(total / N).toFixed(2)} cards/round`)
  }

  console.log('\nWorld Deck tone mix by cabinet instability (avg over 4000 draws):')
  for (const inst of [0.0, 0.3, 0.6]) {
    const rng = makeRng(0xcafe ^ Math.round(inst * 100))
    const counts = { hostile: 0, opportunity: 0, neutral: 0 }
    for (let i = 0; i < N; i++) counts[drawWorldCard(inst, rng).tone]++
    const pct = (n: number) => `${((n / N) * 100).toFixed(0)}%`
    console.log(
      `  instability ${inst.toFixed(1)} : hostile ${pct(counts.hostile).padStart(4)}  ` +
        `opportunity ${pct(counts.opportunity).padStart(4)}  neutral ${pct(counts.neutral).padStart(4)}`,
    )
  }
}

// --- C. Live composed game for one seed ---
function sectionC(scn: Scenario, seed: number) {
  console.log(`\n\n=== C. Live game — scenario "${scn.name}", seed ${seed} ===`)
  console.log('World reacts to state: hot planet -> more events; fractured cabinet -> nastier deck.\n')

  let planet = loadOpeningState()
  let acc = initAccumulators()
  let stocks = initStocks()
  let deathModel = initDeathModel()
  let pipeline = initPipeline()
  let cabinet = initCabinet(null)
  const rng = makeRng(seed)
  let instability = cabinetInstability(cabinet)
  let falls = 0

  for (let round = 1; round <= 12; round++) {
    const script = scn.rounds[round - 1]!

    // Phase 1a: roll the Events Deck (weighted by the current planet) and apply it — this is
    // where feedback cards shorten the pipeline before anything lands this round.
    const fired = rollEvents(planet, rng)
    const ev = applyEvents(fired, pipeline, round)
    pipeline = ev.pipeline

    // Phase 1b: draw one World Deck card (weighted by current cabinet cohesion).
    const worldCard = drawWorldCard(instability, rng)
    const external: ExternalPolitical = { byPortfolio: worldCard.healthDelta, cabinet: worldCard.cabinetHealthDelta }

    // Phase 4: commit legal scripted moves.
    const committed: Committed[] = []
    for (const m of script.moves) {
      const minister = ministerOf(cabinet, m.by)
      if (!isLegalFor(minister, getPolicy(m.policyId))) continue
      committed.push({ policyId: m.policyId, severity: m.severity, by: m.by })
      pipeline = enact(pipeline, m.policyId, m.severity, round, m.by, minister.generation)
    }

    // Phase 6: consequence — land pipeline, merge in event + world planetary pulses.
    const landing = landDue(pipeline, round)
    pipeline = landing.pipeline
    const effects: Partial<PlanetState> = { ...landing.effects }
    for (const pulse of [ev.planetPulse, worldCard.planetPulse]) {
      if (!pulse) continue
      for (const [k, v] of Object.entries(pulse) as [keyof PlanetState, number][]) {
        effects[k] = ((effects[k] as number) ?? 0) + v
      }
    }

    const stepped = stepClimate(planet, acc, effects)
    planet = stepped.planet
    acc = stepped.acc
    stocks = stepStocks(stocks, landing.landed)

    // Political resolution (event domain shocks + world card effects).
    const pol = resolveRound(cabinet, round, committed, landing.landed, ev.domainShocks, external)
    cabinet = pol.cabinet
    falls += pol.successions.length
    instability = cabinetInstability(cabinet)

    // Deaths (so event-driven disaster mortality is visible).
    const ctx: DeathContext = {
      round, planet, stocks,
      shock: combineShocks(ev.disasterShocks),
      politicalInstability: instability,
      cabinetPointsUnspent: 0, unspentOptions: [],
    }
    const resolved = resolveDeaths(ctx, deathModel)
    deathModel = resolved.model
    planet = { ...planet, cumulativeDeaths: resolved.entry.cumulative }

    // Log line.
    const eventStr = fired.length
      ? fired.map((c) => c.name + (c.kind === 'feedback' ? '⚡' : '')).join(', ')
      : '—'
    console.log(
      `R${String(round).padStart(2)} ${planet.tempAnomaly.toFixed(2)}°C inst ${instability.toFixed(2)} │ ` +
        `world: ${worldCard.name} [${worldCard.tone[0]}]`,
    )
    console.log(`        events: ${eventStr}`)
    if (ev.pulledForward.length) {
      for (const pf of ev.pulledForward) console.log(`        ⚡ ${pf}`)
    }
    if (pol.successions.length) {
      console.log('        ' + pol.successions.map((s) => `${CODE[s.portfolio]} fell (${s.cause})→${s.archetype}`).join(', '))
    }
  }

  console.log(
    `\nOutcome: ${(planet.cumulativeDeaths / 1000).toFixed(2)}bn dead, peak-ish temp ${planet.tempAnomaly.toFixed(2)}°C, ` +
      `${falls} ministers fell.`,
  )
}

// --- Entry ---
const name = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'emissions-only'
const scn = SCENARIOS[name]
if (!scn) {
  console.error(`unknown scenario "${name}". options: ${Object.keys(SCENARIOS).join(', ')}`)
  process.exit(1)
}
sectionA()
sectionB()
sectionC(scn, 42)
