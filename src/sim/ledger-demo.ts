// Step-3 ledger demo runner.
//
// This is NOT the game loop and NOT the engine pipeline (step 4). It is minimal /src/sim
// scaffolding whose only job is to drive the planet forward under a scripted scenario so
// the death model (step 3) can be sanity-checked against real numbers, round by round.
//
//   node src/sim/ledger-demo.ts [scenario] [--summary]
//
//   scenario: emissions-only (default) | do-nothing | balanced
//   --summary: print a one-line outcome for all three scenarios instead of a full ledger

import { loadOpeningState } from '../engine/opening-state.ts'
import { stepClimate, initAccumulators } from '../engine/climate.ts'
import { initStocks, stepStocks } from '../engine/stocks.ts'
import {
  initDeathModel,
  resolveDeaths,
  type AvailableOption,
  type DeathContext,
  type DisasterShock,
} from '../engine/death.ts'
import { getTier, POLICIES } from '../engine/policies.ts'
import { initPipeline, enact, landDue, shortenLags } from '../engine/pipeline.ts'
import type { DeathLedgerEntry, PlanetState } from '../engine/types.ts'
import { SCENARIOS, type Scenario } from './scenarios.ts'

// The affordable adaptation/relief tiers the cabinet did NOT enact this round, used to
// derive preventable moments. For the demo we offer the standing menu of protective
// tiers so the preventability calc has something concrete to point at.
function unspentOptions(): AvailableOption[] {
  const wanted: [string, 'light' | 'moderate' | 'aggressive'][] = [
    ['flood-defence', 'moderate'],
    ['heat-adaptation', 'moderate'],
    ['resettlement', 'moderate'],
    ['famine-relief', 'moderate'],
    ['food-resilience', 'moderate'],
  ]
  return wanted.map(([policyId, severity]) => {
    const p = POLICIES.find((x) => x.id === policyId)!
    return { policyId, policyName: p.name, severity, tier: getTier(policyId, severity) }
  })
}

type FeedbackNote = { round: number; label: string; pulledForward: string[] }

type GameResult = {
  ledger: DeathLedgerEntry[]
  temps: number[]           // temperature at the end of each round, parallel to ledger
  finalPlanet: PlanetState
  peakTemp: number
  feedbackNotes: FeedbackNote[]
}

function runScenario(scn: Scenario): GameResult {
  let planet = loadOpeningState()
  let acc = initAccumulators()
  let stocks = initStocks()
  let deathModel = initDeathModel()
  let pipeline = initPipeline()
  const ledger: DeathLedgerEntry[] = []
  const temps: number[] = []
  const feedbackNotes: FeedbackNote[] = []
  let peakTemp = planet.tempAnomaly

  for (let round = 1; round <= 12; round++) {
    const script = scn.rounds[round - 1]!

    // Phase 1 (world): a feedback loop can fire before anything else, retroactively
    // pulling every pending policy forward. Its own warming pulse lands this round too.
    const feedbackEffects: Partial<PlanetState> = {}
    if (script.feedback) {
      const fb = script.feedback
      const shortened = shortenLags(pipeline, fb.shortenBy, round)
      pipeline = shortened.pipeline
      feedbackEffects.methane = (feedbackEffects.methane ?? 0) + fb.methanePulse
      feedbackEffects.tempAnomaly = (feedbackEffects.tempAnomaly ?? 0) + fb.tempPulse
      feedbackNotes.push({
        round,
        label: fb.label,
        pulledForward: shortened.pulledForward.map(
          (e) => `${e.policyId} (${e.severity}) -> lands round ${e.landsRound}`,
        ),
      })
    }

    // Enact this round's moves through the engine pipeline.
    for (const m of script.moves) {
      pipeline = enact(pipeline, m.policyId, m.severity, round, m.by, 1)
    }

    // Consequence phase: everything scheduled to land this round lands now.
    const result = landDue(pipeline, round)
    pipeline = result.pipeline
    const landed = result.landed
    const effects = result.effects
    for (const [k, v] of Object.entries(feedbackEffects) as [keyof PlanetState, number][]) {
      effects[k] = ((effects[k] as number) ?? 0) + v
    }

    // Step the world, then the protective stocks.
    const stepped = stepClimate(planet, acc, effects)
    planet = stepped.planet
    acc = stepped.acc
    stocks = stepStocks(stocks, landed)

    // A scripted physical shock in a couple of rounds so the disaster channel is exercised.
    const shock: DisasterShock | null =
      round === 5 ? { label: 'Category-5 landfall, delta region', magnitude: 55, exposure: 0.9 }
      : round === 9 ? { label: 'Wet-bulb heat event, South Asia', magnitude: 70, exposure: 1.0 }
      : null

    const ctx: DeathContext = {
      round,
      planet,
      stocks,
      shock,
      politicalInstability: script.instability,
      cabinetPointsUnspent: script.pointsUnspent,
      unspentOptions: unspentOptions(),
    }

    const resolved = resolveDeaths(ctx, deathModel)
    deathModel = resolved.model
    ledger.push(resolved.entry)
    temps.push(planet.tempAnomaly)

    // The counter only ever rises.
    planet = { ...planet, cumulativeDeaths: resolved.entry.cumulative }
    peakTemp = Math.max(peakTemp, planet.tempAnomaly)
  }

  return { ledger, temps, finalPlanet: planet, peakTemp, feedbackNotes }
}

// --- Printing ---

const M = (x: number) => x.toFixed(1).padStart(7)

function printLedger(scn: Scenario, result: GameResult): void {
  const { ledger, temps, finalPlanet, peakTemp, feedbackNotes } = result
  console.log(`\n=== LEDGER: ${scn.name} ===`)
  console.log(scn.description)
  console.log(
    `\nAll figures in millions of excess deaths per round (2 years each).\n` +
      `Channels: heat / food / displacement (disp) / disaster / conflict.\n`,
  )
  console.log(
    'rnd  year    temp   heat    food    disp   disast  confl │   total   cumulative',
  )
  console.log('─'.repeat(84))
  ledger.forEach((e, i) => {
    console.log(
      `${String(e.round).padStart(2)}   ${e.year}  ${temps[i]!.toFixed(2).padStart(5)}  ` +
        `${M(e.byChannel.heat)} ${M(e.byChannel.food)} ${M(e.byChannel.displacement)} ` +
        `${M(e.byChannel.disaster)} ${M(e.byChannel.conflict)} │ ${M(e.total)}   ${M(e.cumulative)}`,
    )
  })
  console.log('─'.repeat(84))

  const totalDeaths = ledger[ledger.length - 1]!.cumulative
  console.log(
    `\nFinal 2048 state: temp ${finalPlanet.tempAnomaly.toFixed(2)}°C (peaked ${peakTemp.toFixed(2)}°C), ` +
      `emissions ${finalPlanet.annualEmissions.toFixed(1)} GtCO2e, ` +
      `food-insecure ${Math.round(finalPlanet.foodInsecure)}M, ` +
      `unresettled ${Math.round(finalPlanet.displacedUnresettled)}M.`,
  )
  console.log(`Cumulative excess deaths, 2026-2048: ${(totalDeaths / 1000).toFixed(2)} billion.\n`)

  if (feedbackNotes.length > 0) {
    console.log('Feedback loops fired (pipeline retroactively modified):')
    for (const fn of feedbackNotes) {
      console.log(`  Round ${fn.round}: ${fn.label} — every pending policy pulled forward a round.`)
      for (const pf of fn.pulledForward) console.log(`    ~ ${pf}`)
    }
    console.log()
  }

  // Drivers + preventable moments per round.
  console.log('Round detail (drivers, and what could have cut a channel this round):')
  const notesByRound = new Map(feedbackNotes.map((n) => [n.round, n]))
  for (const e of ledger) {
    const fn = notesByRound.get(e.round)
    if (e.drivers.length === 0 && e.preventable.length === 0 && !fn) continue
    console.log(`\n  Round ${e.round} (${e.year}) — ${M(e.total).trim()}M this round`)
    if (fn) console.log(`    ⚡ ${fn.label}: pipeline lags shortened by 1`)
    for (const dr of e.drivers) console.log(`    · ${dr}`)
    for (const p of e.preventable) {
      console.log(
        `    ! preventable [${p.channel}]: ${p.availablePolicy} for ${p.pointsRequired} pts ` +
          `would have cut ~${p.deathsAvoidable}M — cabinet had ${p.cabinetPointsUnspent} pts unspent`,
      )
    }
  }
  console.log()
}

function printSummary(): void {
  console.log('\n=== OUTCOME SPREAD (step-3 death model sanity check) ===\n')
  console.log('scenario          cum.deaths(bn)   peakTemp   finalEmis   finalFoodInsecure')
  console.log('─'.repeat(78))
  for (const scn of Object.values(SCENARIOS)) {
    const r = runScenario(scn)
    const cum = r.ledger[r.ledger.length - 1]!.cumulative / 1000
    console.log(
      `${scn.name.padEnd(16)}  ${cum.toFixed(2).padStart(12)}   ` +
        `${r.peakTemp.toFixed(2).padStart(7)}   ` +
        `${r.finalPlanet.annualEmissions.toFixed(1).padStart(8)}   ` +
        `${String(Math.round(r.finalPlanet.foodInsecure)).padStart(14)}`,
    )
  }
  console.log('\nThe spread between best and worst available is the whole test.\n')
}

// --- Entry ---

const args = process.argv.slice(2)
if (args.includes('--summary')) {
  printSummary()
} else {
  const name = args.find((a) => !a.startsWith('--')) ?? 'emissions-only'
  const scn = SCENARIOS[name]
  if (!scn) {
    console.error(`unknown scenario "${name}". options: ${Object.keys(SCENARIOS).join(', ')}`)
    process.exit(1)
  }
  printLedger(scn, runScenario(scn))
}
