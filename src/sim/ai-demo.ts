// Step-7 AI demo.
//
// The first fully AI-driven, budget-legal game: all six seats are scripted AI ministers
// deciding on doctrine + forecast + political health + exposure. Prints the phase-3
// declarations each round so you can read the cabinet negotiating with itself — and, above
// all, refusing to take the hit.
//
//   node src/sim/ai-demo.ts [seed] [--round N]
//     --round N : print the full declaration block for round N (default: rounds with a refusal)

import { loadOpeningState } from '../engine/opening-state.ts'
import { stepClimate, initAccumulators } from '../engine/climate.ts'
import { initStocks, stepStocks } from '../engine/stocks.ts'
import { initDeathModel, resolveDeaths, type DeathContext } from '../engine/death.ts'
import { initPipeline, enact, landDue } from '../engine/pipeline.ts'
import {
  initCabinet, resolveRound, budgetFor, cabinetInstability, ministerOf,
  type Committed, type ExternalPolitical,
} from '../engine/political.ts'
import { rollEvents, applyEvents, combineShocks } from '../engine/events-deck.ts'
import { drawWorldCard } from '../engine/world-deck.ts'
import { assignForecasts } from '../engine/forecast.ts'
import { decide } from '../engine/ai.ts'
import { makeRng } from '../engine/rng.ts'
import type { PlanetState, PortfolioId } from '../engine/types.ts'

const PORTFOLIOS: PortfolioId[] = [
  'energy', 'agriculture', 'treasury', 'foreign', 'environment', 'resilience',
]
const CODE: Record<PortfolioId, string> = {
  energy: 'ENE', agriculture: 'AGR', treasury: 'TRE',
  foreign: 'FOR', environment: 'ENV', resilience: 'RES',
}

function run(seed: number) {
  let planet = loadOpeningState()
  let acc = initAccumulators()
  let stocks = initStocks()
  let deathModel = initDeathModel()
  let pipeline = initPipeline()
  let cabinet = initCabinet(null)
  const rng = makeRng(seed)
  const forecasts = assignForecasts(rng.fork(99))
  let instability = cabinetInstability(cabinet)
  let falls = 0

  const rounds: {
    round: number; temp: number; instability: number
    world: string; events: string[]; pulled: string[]
    declarations: string[]; refusals: number; successions: string[]
    deathsThisRound: number; cumulative: number
  }[] = []

  for (let round = 1; round <= 12; round++) {
    // Phase 1: events (weighted by planet), then world card (weighted by cohesion).
    const fired = rollEvents(planet, rng)
    const ev = applyEvents(fired, pipeline, round)
    pipeline = ev.pipeline
    const worldCard = drawWorldCard(instability, rng)
    const external: ExternalPolitical = { byPortfolio: worldCard.healthDelta, cabinet: worldCard.cabinetHealthDelta }

    // Phases 3-4: each AI minister declares and commits within its budget.
    const committed: Committed[] = []
    const declarations: string[] = []
    let refusals = 0
    for (const p of PORTFOLIOS) {
      const m = ministerOf(cabinet, p)
      const d = decide(m, forecasts[p], planet, budgetFor(m))
      declarations.push(d.declaration)
      if (d.refusedAggressive) refusals++
      if (d.move) {
        committed.push(d.move)
        pipeline = enact(pipeline, d.move.policyId, d.move.severity, round, p, m.generation)
      }
    }

    // Phase 6: consequence.
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

    const pol = resolveRound(cabinet, round, committed, landing.landed, ev.domainShocks, external)
    cabinet = pol.cabinet
    falls += pol.successions.length
    instability = cabinetInstability(cabinet)

    const ctx: DeathContext = {
      round, planet, stocks, shock: combineShocks(ev.disasterShocks),
      politicalInstability: instability, cabinetPointsUnspent: 0, unspentOptions: [],
    }
    const resolved = resolveDeaths(ctx, deathModel)
    deathModel = resolved.model
    planet = { ...planet, cumulativeDeaths: resolved.entry.cumulative }

    rounds.push({
      round, temp: planet.tempAnomaly, instability,
      world: worldCard.name, events: fired.map((c) => c.name + (c.kind === 'feedback' ? '⚡' : '')),
      pulled: ev.pulledForward, declarations, refusals,
      successions: pol.successions.map((s) => `${CODE[s.portfolio]} fell (${s.cause})→${s.archetype}`),
      deathsThisRound: resolved.entry.total, cumulative: resolved.entry.cumulative,
    })
  }

  return { rounds, cabinet, forecasts, falls, planet }
}

// --- Printing ---

function main() {
  const args = process.argv.slice(2)
  const seed = Number(args.find((a) => !a.startsWith('--')) ?? 42)
  const roundArg = args.includes('--round') ? Number(args[args.indexOf('--round') + 1]) : null

  const { rounds, cabinet, forecasts, falls, planet } = run(seed)

  console.log(`\n=== AI-DRIVEN GAME (all six seats scripted AI) — seed ${seed} ===\n`)
  console.log('rnd  temp   inst  deaths │ world card / events')
  console.log('─'.repeat(76))
  for (const r of rounds) {
    const ev = r.events.length ? r.events.join(', ') : '—'
    console.log(
      `${String(r.round).padStart(2)}  ${r.temp.toFixed(2)}  ${r.instability.toFixed(2)}  ` +
        `${r.deathsThisRound.toFixed(0).padStart(4)}M │ ${r.world}` + (r.events.length ? `  ‹${ev}›` : ''),
    )
    if (r.successions.length) console.log(`             ↳ ${r.successions.join(', ')}`)
    if (r.pulled.length) for (const p of r.pulled) console.log(`             ⚡ ${p}`)
  }
  console.log('─'.repeat(76))
  console.log(
    `\nOutcome: ${(planet.cumulativeDeaths / 1000).toFixed(2)}bn dead, final temp ${planet.tempAnomaly.toFixed(2)}°C, ` +
      `${falls} ministers fell.`,
  )

  // Show the phase-3 declaration blocks: every round with a refusal, plus any requested round.
  const toShow = rounds.filter((r) => r.refusals > 0 || r.round === roundArg)
  console.log(`\n=== Phase-3 declarations ${roundArg ? `(round ${roundArg} + ` : '('}rounds with a refusal) ===`)
  if (toShow.length === 0) console.log('  No refusals this game — the cabinet could always afford its choices.')
  for (const r of toShow) {
    console.log(`\n  Round ${r.round} (${r.temp.toFixed(2)}°C):`)
    for (const d of r.declarations) console.log(`    ${d}`)
  }

  // Forecast lenses held (all six are sound; they differ in emphasis and concern).
  console.log('\n[forecasts held this game]')
  for (const p of PORTFOLIOS) console.log(`  ${CODE[p]}: ${forecasts[p].name} (foregrounds ${forecasts[p].emphasis})`)
  console.log()
}

main()
