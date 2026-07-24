// The composed game loop, extracted so the demos and the step-9 batch runner share one
// implementation. Pure of console I/O: it plays a single game and returns a rich record.
//
// One seat (the "player seat") can be driven by a scripted strategy; the other five are AI.
// Passing no strategy makes all six seats AI.

import { loadOpeningState } from '../engine/opening-state.ts'
import { stepClimate, initAccumulators } from '../engine/climate.ts'
import { initStocks, stepStocks } from '../engine/stocks.ts'
import {
  initDeathModel, resolveDeaths, type DeathContext, type AvailableOption,
} from '../engine/death.ts'
import { getTier, getPolicy, POLICIES } from '../engine/policies.ts'
import { initPipeline, enact, landDue } from '../engine/pipeline.ts'
import {
  initCabinet, resolveRound, budgetFor, pointCostFor, cabinetInstability, ministerOf,
  type Committed, type ExternalPolitical, type SuccessionEvent,
} from '../engine/political.ts'
import { rollEvents, applyEvents, combineShocks } from '../engine/events-deck.ts'
import { drawWorldCard } from '../engine/world-deck.ts'
import { assignForecasts, vindicatedSeat, type ForecastModel } from '../engine/forecast.ts'
import { decide } from '../engine/ai.ts'
import { decideStrategy, type StrategyName } from '../engine/strategies.ts'
import { makeRng } from '../engine/rng.ts'
import type { DeathChannel, DeathLedgerEntry, PlanetState, PortfolioId } from '../engine/types.ts'

// The death channel with the largest cumulative share across the game.
function dominantDeathChannel(ledger: DeathLedgerEntry[]): DeathChannel {
  const tot: Record<DeathChannel, number> = { heat: 0, food: 0, displacement: 0, disaster: 0, conflict: 0 }
  for (const e of ledger) for (const c of Object.keys(tot) as DeathChannel[]) tot[c] += e.byChannel[c]
  return (Object.keys(tot) as DeathChannel[]).reduce((a, b) => (tot[b] > tot[a] ? b : a))
}

const PORTFOLIOS: PortfolioId[] = [
  'energy', 'agriculture', 'treasury', 'foreign', 'environment', 'resilience',
]

// Post-mandate settling window: rounds of consequence-only momentum after the 12 decision
// rounds, so the final round's fast levers land before the world is assessed. 2 rounds = the
// "four years on" epilogue framing. Long-lag policies started too late still miss.
export const SETTLE_ROUNDS = 2

// The standing protective menu the preventability calc points at (moderate tiers).
const PROTECTIVE: [string, 'moderate'][] = [
  ['flood-defence', 'moderate'], ['heat-adaptation', 'moderate'], ['resettlement', 'moderate'],
  ['famine-relief', 'moderate'], ['food-resilience', 'moderate'],
]

export type GameConfig = {
  seed: number
  playerSeat?: PortfolioId
  strategy?: StrategyName   // undefined = all AI
}

export type RoundRecord = {
  round: number
  temp: number
  instability: number
  deathsThisRound: number
  cumulative: number
  worldCard: string
  events: string[]
  feedbackCount: number
  disasterMagnitude: number
  pulledForward: string[]
  declarations: string[]
  successions: SuccessionEvent[]
}

export type GameRecord = {
  config: GameConfig
  rounds: RoundRecord[]
  ledger: DeathLedgerEntry[]
  finalPlanet: PlanetState
  peakTemp: number
  totalDeaths: number            // millions
  successions: SuccessionEvent[]
  falls: number
  forecasts: Record<PortfolioId, ForecastModel>
  // The lens that turned out to matter — the model foregrounding the dominant death channel.
  vindicatedSeat: PortfolioId
  vindicatedEmphasis: string
  vindicatedSeatFinalGeneration: number
  dominantChannel: DeathChannel
  // event-influence aggregates, for the batch correlation report
  totalFeedbackCards: number
  totalDisasterMagnitude: number
}

export function playGame(config: GameConfig): GameRecord {
  const playerSeat = config.playerSeat ?? 'treasury'
  let planet = loadOpeningState()
  let acc = initAccumulators()
  let stocks = initStocks()
  let deathModel = initDeathModel()
  let pipeline = initPipeline()
  let cabinet = initCabinet(config.strategy ? playerSeat : null)
  const rng = makeRng(config.seed)
  const forecasts = assignForecasts(rng.fork(99))
  let instability = cabinetInstability(cabinet)

  const rounds: RoundRecord[] = []
  const ledger: DeathLedgerEntry[] = []
  const allSuccessions: SuccessionEvent[] = []
  let peakTemp = planet.tempAnomaly
  let totalFeedbackCards = 0
  let totalDisasterMagnitude = 0

  for (let round = 1; round <= 12; round++) {
    // Phase 1: events (weighted by planet), then world card (weighted by cohesion).
    const fired = rollEvents(planet, rng)
    const ev = applyEvents(fired, pipeline, round)
    pipeline = ev.pipeline
    const worldCard = drawWorldCard(instability, rng)
    const external: ExternalPolitical = { byPortfolio: worldCard.healthDelta, cabinet: worldCard.cabinetHealthDelta }

    // Phases 3-4: commitments. Player seat uses the strategy; others use AI.
    const committed: Committed[] = []
    const declarations: string[] = []
    const spentBy = new Map<PortfolioId, number>()
    for (const p of PORTFOLIOS) {
      const m = ministerOf(cabinet, p)
      const budget = budgetFor(m)
      let move: Committed | null
      if (config.strategy && p === playerSeat) {
        move = decideStrategy(config.strategy, { minister: m, planet, budget, round, rng })
      } else {
        const d = decide(m, forecasts[p], planet, budget)
        declarations.push(d.declaration)
        move = d.move
      }
      if (move) {
        committed.push(move)
        spentBy.set(p, pointCostFor(m, getPolicy(move.policyId), getTier(move.policyId, move.severity)))
        pipeline = enact(pipeline, move.policyId, move.severity, round, p, m.generation)
      }
    }

    // Unspent points + affordable protective options this round, for the preventable calc.
    let cabinetPointsUnspent = 0
    let maxLeftover = 0
    for (const p of PORTFOLIOS) {
      const leftover = budgetFor(ministerOf(cabinet, p)) - (spentBy.get(p) ?? 0)
      cabinetPointsUnspent += leftover
      maxLeftover = Math.max(maxLeftover, leftover)
    }
    const unspentOptions: AvailableOption[] = PROTECTIVE
      .filter(([id]) => getTier(id, 'moderate').pointCost <= maxLeftover)
      .map(([id, sev]) => ({ policyId: id, policyName: getPolicy(id).name, severity: sev, tier: getTier(id, sev) }))

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
    peakTemp = Math.max(peakTemp, planet.tempAnomaly)

    const pol = resolveRound(cabinet, round, committed, landing.landed, ev.domainShocks, external)
    cabinet = pol.cabinet
    allSuccessions.push(...pol.successions)
    instability = cabinetInstability(cabinet)

    const shock = combineShocks(ev.disasterShocks)
    const ctx: DeathContext = {
      round, planet, stocks, shock,
      politicalInstability: instability, cabinetPointsUnspent, unspentOptions,
    }
    const resolved = resolveDeaths(ctx, deathModel)
    deathModel = resolved.model
    ledger.push(resolved.entry)
    planet = { ...planet, cumulativeDeaths: resolved.entry.cumulative }

    const feedbackCount = fired.filter((c) => c.kind === 'feedback').length
    const disasterMag = ev.disasterShocks.reduce((a, s) => a + s.magnitude * s.exposure, 0)
    totalFeedbackCards += feedbackCount
    totalDisasterMagnitude += disasterMag

    rounds.push({
      round, temp: planet.tempAnomaly, instability,
      deathsThisRound: resolved.entry.total, cumulative: resolved.entry.cumulative,
      worldCard: worldCard.name, events: fired.map((c) => c.name + (c.kind === 'feedback' ? '⚡' : '')),
      feedbackCount, disasterMagnitude: disasterMag, pulledForward: ev.pulledForward,
      declarations, successions: pol.successions,
    })
  }

  // Post-mandate settling: the mandate's final decisions take four more years to land. No new
  // commitments and no new events — momentum only — so the fast levers pulled at the end
  // arrive and count, while anything long-lag started too late still misses. The world is
  // assessed once the dust settles.
  for (let s = 1; s <= SETTLE_ROUNDS; s++) {
    const settleRound = 12 + s
    const landing = landDue(pipeline, settleRound)
    pipeline = landing.pipeline
    const stepped = stepClimate(planet, acc, landing.effects)
    planet = stepped.planet; acc = stepped.acc
    stocks = stepStocks(stocks, landing.landed)
    peakTemp = Math.max(peakTemp, planet.tempAnomaly)
    const resolved = resolveDeaths(
      { round: settleRound, planet, stocks, shock: null, politicalInstability: instability, cabinetPointsUnspent: 0, unspentOptions: [] },
      deathModel,
    )
    deathModel = resolved.model
    ledger.push(resolved.entry)
    planet = { ...planet, cumulativeDeaths: resolved.entry.cumulative }
  }

  const dominantChannel = dominantDeathChannel(ledger)
  const vind = vindicatedSeat(forecasts, dominantChannel)
  return {
    config, rounds, ledger,
    finalPlanet: planet, peakTemp,
    totalDeaths: planet.cumulativeDeaths,
    successions: allSuccessions, falls: allSuccessions.length,
    forecasts,
    vindicatedSeat: vind.seat, vindicatedEmphasis: vind.emphasis,
    vindicatedSeatFinalGeneration: ministerOf(cabinet, vind.seat).generation,
    dominantChannel,
    totalFeedbackCards, totalDisasterMagnitude,
  }
}
