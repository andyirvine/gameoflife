// Server-side round resolution for the 6-human multiplayer game. Structurally parallel to
// src/ui/session.ts's Session, and calls the exact same /src/engine functions — but Session
// is built around one human seat plus decide() calls for five AI colleagues, which doesn't
// fit multiplayer's "all six are real people" shape. Rather than bend Session to cover both,
// this is a standalone class so neither is warped by the other's assumptions.
//
// Zero ws/Node dependency (matches room.ts) — this only touches /src/engine.

import { loadOpeningState } from '../engine/opening-state.ts'
import { stepClimate, initAccumulators, type ClimateAccumulators } from '../engine/climate.ts'
import { initStocks, stepStocks } from '../engine/stocks.ts'
import { initDeathModel, resolveDeaths, type DeathModelState } from '../engine/death.ts'
import { getPolicy, getTier } from '../engine/policies.ts'
import { initPipeline, enact, landDue, type Pipeline } from '../engine/pipeline.ts'
import {
  initCabinet, resolveRound, budgetFor, ministerOf, cabinetInstability,
  type Committed, type ExternalPolitical,
} from '../engine/political.ts'
import { rollEvents, applyEvents, combineShocks } from '../engine/events-deck.ts'
import { drawWorldCard } from '../engine/world-deck.ts'
import { makeRng } from '../engine/rng.ts'
import { assessTargets, type TargetResult } from '../engine/targets.ts'
import type { Cabinet, DeathChannel, DeathLedgerEntry, MitigationStocks, PlanetState, PortfolioId, Severity } from '../engine/types.ts'

export const PORTFOLIOS: PortfolioId[] = ['energy', 'agriculture', 'treasury', 'foreign', 'environment', 'resilience']

// What a client sends for its own seat when committing: policy + severity per move, no `by`
// (the server attaches that from the token's claimed seat, same trust boundary as Room today).
export type SeatMove = { policyId: string; severity: Severity }

export type SeatSummary = {
  portfolio: PortfolioId
  health: number
  doctrine: string
  generation: number
  budget: number
  restrictions: { forbidsFlag: string | null; roundsRemaining: number }[]
}

export type TrajectoryPoint = { round: number; year: number; temp: number; deaths: number; unresettled: number }

// World-level flavour for the round in progress — same for all 6 seats, unlike the menu.
export type Newsflash = {
  worldCard: { name: string; tone: string; flavor: string }
  events: { name: string; flavor: string; feedback: boolean }[]
}

export type EpilogueSummary = {
  year: number
  peakTemp: number
  falling: boolean
  cumulativeDeaths: number
  targets: TargetResult[]
  targetsHit: number
  falls: number
  dominant: DeathChannel
}

// The "cabinet reveals" beat: every seat's real committed moves (or that they held), for the
// round that just resolved.
export type RoundReveal = {
  round: number
  year: number
  moves: { seat: PortfolioId; policyName: string; severity: Severity; lag: number; landsRound: number }[]
  held: PortfolioId[]
  total: number
  byChannel: Record<DeathChannel, number>
  cumulative: number
  successions: { portfolio: PortfolioId; cause: string; archetype: string }[]
}

export class MultiplayerSession {
  round = 1

  private planet: PlanetState
  private acc: ClimateAccumulators
  private stocks: MitigationStocks = initStocks()
  private deathModel: DeathModelState = initDeathModel()
  private pipeline: Pipeline = initPipeline()
  private cabinet: Cabinet
  private rng: ReturnType<typeof makeRng>
  private instability: number
  private peakTemp: number

  private _pendingWorldCard!: ReturnType<typeof drawWorldCard>
  private _ev!: ReturnType<typeof applyEvents>
  private _events: ReturnType<typeof rollEvents> = []

  history: TrajectoryPoint[] = []
  ledger: DeathLedgerEntry[] = []
  lastReveal: RoundReveal | null = null
  private fallCount = 0

  constructor(seed: number) {
    this.planet = loadOpeningState()
    this.acc = initAccumulators()
    this.cabinet = initCabinet(null)
    this.rng = makeRng(seed)
    this.instability = cabinetInstability(this.cabinet)
    this.peakTemp = this.planet.tempAnomaly
    this.history.push(point(0, this.planet))
    this.beginRound()
  }

  private beginRound() {
    this._events = rollEvents(this.planet, this.rng)
    const ev = applyEvents(this._events, this.pipeline, this.round)
    this.pipeline = ev.pipeline
    this._ev = ev
    this._pendingWorldCard = drawWorldCard(this.instability, this.rng)
  }

  budgetFor(seat: PortfolioId): number {
    return budgetFor(ministerOf(this.cabinet, seat))
  }

  cabinetSummary(): SeatSummary[] {
    return PORTFOLIOS.map((p) => {
      const m = ministerOf(this.cabinet, p)
      return {
        portfolio: p, health: m.politicalHealth, doctrine: m.doctrine, generation: m.generation,
        budget: budgetFor(m),
        restrictions: m.restrictions.map((r) => ({ forbidsFlag: r.forbidsFlag, roundsRemaining: r.roundsRemaining })),
      }
    })
  }

  planetState(): PlanetState {
    return this.planet
  }

  newsflash(): Newsflash {
    return {
      worldCard: { name: this._pendingWorldCard.name, tone: this._pendingWorldCard.tone, flavor: this._pendingWorldCard.flavor },
      events: this._events.map((e) => ({ name: e.name, flavor: e.flavor, feedback: e.kind === 'feedback' })),
    }
  }

  epilogueSummary(): EpilogueSummary {
    const chan: Record<DeathChannel, number> = { heat: 0, food: 0, displacement: 0, disaster: 0, conflict: 0 }
    for (const e of this.ledger) for (const c of Object.keys(chan) as DeathChannel[]) chan[c] += e.byChannel[c]
    const dominant = (Object.keys(chan) as DeathChannel[]).reduce((a, b) => (chan[b] > chan[a] ? b : a))
    const targets = assessTargets(this.planet, this.peakTemp)
    return {
      year: this.planet.year,
      peakTemp: this.peakTemp,
      falling: this.planet.tempAnomaly < this.peakTemp - 0.01,
      cumulativeDeaths: this.planet.cumulativeDeaths,
      targets,
      targetsHit: targets.filter((t) => t.hit).length,
      falls: this.fallCount,
      dominant,
    }
  }

  // Resolve the round now that every seat has committed (Room only calls this once all 6
  // have). `moves` supplies each seat's chosen policies; a seat absent from the map held.
  resolve(moves: Partial<Record<PortfolioId, SeatMove[]>>): RoundReveal {
    const committed: Committed[] = []
    for (const seat of PORTFOLIOS) {
      const seatMoves = moves[seat] ?? []
      for (const mv of seatMoves) committed.push({ policyId: mv.policyId, severity: mv.severity, by: seat })
    }

    for (const mv of committed) {
      const gen = ministerOf(this.cabinet, mv.by).generation
      this.pipeline = enact(this.pipeline, mv.policyId, mv.severity, this.round, mv.by, gen)
    }

    const landing = landDue(this.pipeline, this.round)
    this.pipeline = landing.pipeline
    const effects: Partial<PlanetState> = { ...landing.effects }
    for (const pulse of [this._ev.planetPulse, this._pendingWorldCard.planetPulse]) {
      if (!pulse) continue
      for (const [k, v] of Object.entries(pulse) as [keyof PlanetState, number][]) {
        effects[k] = ((effects[k] as number) ?? 0) + v
      }
    }
    const stepped = stepClimate(this.planet, this.acc, effects)
    this.planet = stepped.planet
    this.acc = stepped.acc
    this.stocks = stepStocks(this.stocks, landing.landed)
    this.peakTemp = Math.max(this.peakTemp, this.planet.tempAnomaly)

    const external: ExternalPolitical = { byPortfolio: this._pendingWorldCard.healthDelta, cabinet: this._pendingWorldCard.cabinetHealthDelta }
    const pol = resolveRound(this.cabinet, this.round, committed, landing.landed, this._ev.domainShocks, external)
    this.cabinet = pol.cabinet
    this.instability = cabinetInstability(this.cabinet)
    this.fallCount += pol.successions.length

    const resolved = resolveDeaths(
      { round: this.round, planet: this.planet, stocks: this.stocks, shock: combineShocks(this._ev.disasterShocks), politicalInstability: this.instability, cabinetPointsUnspent: 0, unspentOptions: [] },
      this.deathModel,
    )
    this.deathModel = resolved.model
    this.ledger.push(resolved.entry)
    this.planet = { ...this.planet, cumulativeDeaths: resolved.entry.cumulative }

    const reveal: RoundReveal = {
      round: this.round,
      year: this.planet.year,
      moves: committed.map((mv) => {
        const tier = getTier(mv.policyId, mv.severity)
        return { seat: mv.by, policyName: getPolicy(mv.policyId).name, severity: mv.severity, lag: tier.lag, landsRound: this.round + tier.lag }
      }),
      held: PORTFOLIOS.filter((p) => !(moves[p] ?? []).length),
      total: resolved.entry.total,
      byChannel: resolved.entry.byChannel,
      cumulative: resolved.entry.cumulative,
      successions: pol.successions.map((s) => ({ portfolio: s.portfolio, cause: s.cause, archetype: s.archetype })),
    }
    this.lastReveal = reveal

    this.history.push(point(this.round, this.planet))

    if (this.round >= 12) {
      this.round = 12
    } else {
      this.round += 1
      this.beginRound()
    }
    return reveal
  }
}

function point(round: number, planet: PlanetState): TrajectoryPoint {
  return { round, year: planet.year, temp: planet.tempAnomaly, deaths: planet.cumulativeDeaths, unresettled: planet.displacedUnresettled }
}
