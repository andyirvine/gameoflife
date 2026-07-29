// Game session controller for the UI. Holds the mutable game state and drives the engine's
// round loop through method calls (the browser equivalent of play.ts's readline loop). The
// engine in /src/engine stays pure and untouched; this only orchestrates it.

import { loadOpeningState } from '../engine/opening-state.ts'
import { stepClimate, initAccumulators, type ClimateAccumulators } from '../engine/climate.ts'
import { initStocks, stepStocks } from '../engine/stocks.ts'
import { initDeathModel, resolveDeaths, type DeathModelState } from '../engine/death.ts'
import { getTier, getPolicy, policiesByDomain } from '../engine/policies.ts'
import { policyCopy } from '../engine/policy-copy.ts'
import { initPipeline, enact, landDue, type Pipeline } from '../engine/pipeline.ts'
import {
  initCabinet, resolveRound, budgetFor, pointCostFor, isLegalFor, cabinetInstability, ministerOf,
  type Committed, type ExternalPolitical, type SuccessionEvent,
} from '../engine/political.ts'
import { rollEvents, applyEvents, combineShocks, type EventCard } from '../engine/events-deck.ts'
import { drawWorldCard, type WorldCard } from '../engine/world-deck.ts'
import { assignForecasts, projectForecast, vindicatedSeat, type ForecastModel } from '../engine/forecast.ts'
import { decide } from '../engine/ai.ts'
import { makeRng } from '../engine/rng.ts'
import { assessTargets } from '../engine/targets.ts'
import type {
  Cabinet, DeathChannel, DeathLedgerEntry, Minister, PlanetState, PortfolioId, Severity,
} from '../engine/types.ts'

const SETTLE_ROUNDS = 2
export const PORTFOLIOS: PortfolioId[] = ['energy', 'agriculture', 'treasury', 'foreign', 'environment', 'resilience']
export const SEAT_NAME: Record<PortfolioId, string> = {
  energy: 'Energy', agriculture: 'Agriculture & Land', treasury: 'Treasury',
  foreign: 'Foreign & Trade', environment: 'Environment', resilience: 'Civil Resilience',
}
export const SEAT_WEAKNESS: Record<PortfolioId, string> = {
  energy: 'blamed first for price shocks and blackouts',
  agriculture: 'rural base, fastest to riot',
  treasury: 'owns every downturn, blamed for every cost',
  foreign: 'no domestic base to protect you',
  environment: 'cheap wins, perpetually accused of irrelevance',
  resilience: 'only visible after something has already gone wrong',
}

// A curated, emotive reaction for the events that most demand a specific response, keyed by
// the Events Deck card id (src/engine/events-deck.ts). `severity` ranks which event to lead
// with when several land in one round; `priority` steers the recommended policy toward the
// channel this event actually threatens.
const EVENT_PLEA: Record<string, EventPlea> = {
  'drought-belt': { priority: 'relief', severity: 6,
    text: "the drought belt just widened again, and it does not retreat. Every round we do not answer it, more of the harvest fails for good — please, feed people before the numbers make it abstract." },
  'monsoon-failure': { priority: 'relief', severity: 7,
    text: 'a season of harvest is gone. The families it fed cannot wait for next year\'s policy — relief now costs less in lives than it will in two.' },
  'regional-crop-failure': { priority: 'relief', severity: 6,
    text: 'a staple crop has failed across several states. We are asking you, plainly: fund the relief before the famine numbers are the story, not the warning.' },
  'category5-cyclone': { priority: 'resilience', severity: 7,
    text: 'a storm has already hit a coastline we had not defended. Flood defence and resettlement were affordable yesterday; today they are overdue.' },
  'wet-bulb-event': { priority: 'resilience', severity: 8,
    text: 'people are dying of heat we did not adapt for. Every point spent on cooling now lands before the bodies do, not after — please do not let this one pass quietly.' },
  'heatwave-cluster': { priority: 'resilience', severity: 6,
    text: 'a heat dome is sitting over cities that have no cooling plan. This is exactly the round adaptation earns its keep.' },
  'glacial-melt-stress': { priority: 'resilience', severity: 5,
    text: 'the rivers that fed the dry season are already running short. Resilience spent here is cheaper than the water war that follows it.' },
  'coral-collapse': { priority: 'mitigation', severity: 4,
    text: 'the reef fisheries are going with the bleaching. It will read as scenery lost while people are dying elsewhere — it is not. It is food, and it is going.' },
  'sea-level-surge': { priority: 'resilience', severity: 6,
    text: 'a coastal surge has already put people underwater who had nowhere else to go. Resettlement paid for now is a life saved later, not a statistic changed.' },
  'siberian-methane': { priority: 'mitigation', severity: 9,
    text: 'the methane just released will not wait for a five-year plan. Every lag you were counting on just got shorter — please, do not bank on timelines that no longer exist.' },
  'permafrost-carbon': { priority: 'mitigation', severity: 8,
    text: 'the tundra has started emitting on its own. The budget you were governing to just shrank without asking you, and it will keep shrinking.' },
  'amazon-dieback': { priority: 'mitigation', severity: 8,
    text: 'the rainforest has tipped from sink to source. Restoration placed years out is moot now — what you do this round is what still counts.' },
  'amoc-disruption': { priority: 'relief', severity: 8,
    text: 'the circulation is stalling and breadbaskets are failing out of season. We are begging you to move on food before this compounds further.' },
  'ice-sheet-instability': { priority: 'resilience', severity: 8,
    text: 'a marine ice cliff has let go. Coastlines are moving faster than the pipeline can answer — resettlement and resilience cannot wait for the next plan.' },
  'tipping-cascade': { priority: 'mitigation', severity: 10,
    text: 'several tipping points have fired together. We do not have a gentler way to say this: nothing in flight will arrive in time unless you act this round.' },
}

export type MenuTier = {
  policyId: string; policyName: string; summary: string; severity: Severity
  cost: number; lag: number; effect: string; selfCost: number
  spill: { seat: PortfolioId; amount: number; resultHealth: number }[]
  // numeric impact, so advisors can reason about tiers without re-parsing the display string
  impact: { mitigation: number; relief: number; resilience: number }
  topples: boolean  // would this tier, on its own, fell a colleague already near the edge?
  selected: boolean  // is this exact tier the one currently chosen for its policy this round?
  disabled: boolean  // restricted, superseded by a different tier of the same policy, or unaffordable
}

export type Advisor = { name: string; role: string; lines: string[] }
type EventPlea = { priority: 'mitigation' | 'relief' | 'resilience'; severity: number; text: string }
export type PipelineItem = { policyName: string; severity: Severity; landsRound: number; eta: string; by: PortfolioId; mine: boolean }
export type Consequence = {
  round: number; year: number; total: number; byChannel: Record<DeathChannel, number>; cumulative: number
  successions: { portfolio: PortfolioId; cause: string; archetype: string; byPlayer: boolean }[]
  cabinetMoves: { seat: PortfolioId; name: string; severity: Severity }[]
  playerMoves: { name: string; severity: Severity }[]
  spilled: { seat: PortfolioId; amount: number }[]
}

export class Session {
  seed: number
  seat: PortfolioId
  round = 1
  phase: 'commit' | 'consequence' | 'settling' | 'epilogue' = 'commit'

  private planet: PlanetState
  private acc: ClimateAccumulators
  private stocks = initStocks()
  private deathModel: DeathModelState = initDeathModel()
  private pipeline: Pipeline = initPipeline()
  private cabinet: Cabinet
  private rng: ReturnType<typeof makeRng>
  private forecasts: Record<PortfolioId, ForecastModel>
  private instability: number
  private peakTemp: number

  // per-round world phase
  private events: EventCard[] = []
  private worldCard!: WorldCard
  private pulledForward: string[] = []
  private aiMoves: Committed[] = []
  private declarations: string[] = []

  // records
  ledger: DeathLedgerEntry[] = []
  successions: SuccessionEvent[] = []
  tradeLedger: string[] = []
  did = { emissions: 0, methane: 0, relief: 0, resilience: 0, healthSpent: 0, roundsActed: 0, roundsHeld: 0, toppled: 0 }
  lastConsequence: Consequence | null = null

  constructor(seed: number, seat: PortfolioId) {
    this.seed = seed
    this.seat = seat
    this.planet = loadOpeningState()
    this.acc = initAccumulators()
    this.cabinet = initCabinet(seat)
    this.rng = makeRng(seed)
    this.forecasts = assignForecasts(this.rng.fork(99))
    this.instability = cabinetInstability(this.cabinet)
    this.peakTemp = this.planet.tempAnomaly
    this.beginRound()
  }

  private beginRound() {
    this.events = rollEvents(this.planet, this.rng)
    const ev = applyEvents(this.events, this.pipeline, this.round)
    this.pipeline = ev.pipeline
    this.pulledForward = ev.pulledForward
    this.worldCard = drawWorldCard(this.instability, this.rng)
    this.aiMoves = []
    this.declarations = []
    for (const p of PORTFOLIOS) {
      if (p === this.seat) continue
      const m = ministerOf(this.cabinet, p)
      const d = decide(m, this.forecasts[p], this.planet, budgetFor(m))
      this.declarations.push(`${SEAT_NAME[p].split(' ')[0]}: ${d.declaration.replace(/^[^:]+:\s*/, '')}`)
      if (d.move) this.aiMoves.push(d.move)
    }
    // stash the fired events' outcome for commit
    this._ev = ev
    this.phase = 'commit'
  }
  private _ev!: ReturnType<typeof applyEvents>

  // The player's own-portfolio menu, given tiers already selected this round. Returns the
  // FULL catalogue for the seat — every tier, always — tagged with `selected` and `disabled`
  // so the UI can grey out unavailable options rather than hiding them. A tier is disabled
  // when the policy is restricted, when a different tier of the same policy is already
  // selected (one tier per policy per round), or when it no longer fits the remaining budget.
  // The currently-selected tier is never disabled, so it can always be toggled back off.
  menu(selected: Committed[]): MenuTier[] {
    const you = ministerOf(this.cabinet, this.seat)
    const budget = budgetFor(you)
    const spentTotal = selected.reduce((a, s) => a + pointCostFor(you, getPolicy(s.policyId), getTier(s.policyId, s.severity)), 0)
    const sevs: Severity[] = ['light', 'moderate', 'aggressive']
    const out: MenuTier[] = []
    for (const policy of policiesByDomain(this.seat)) {
      const legal = isLegalFor(you, policy)
      const pickedSeverity = selected.find((s) => s.policyId === policy.id)?.severity
      for (let i = 0; i < 3; i++) {
        const tier = policy.tiers[i]!
        const severity = sevs[i]!
        const cost = pointCostFor(you, policy, tier)
        const isSelected = pickedSeverity === severity
        const affordable = isSelected || (budget - spentTotal) >= cost
        const disabled = !legal || (pickedSeverity !== undefined && !isSelected) || !affordable
        const spill = (Object.entries(tier.politicalCost) as [PortfolioId, number][])
          .filter(([p, v]) => p !== this.seat && v !== 0)
          .map(([p, v]) => ({ seat: p, amount: v, resultHealth: ministerOf(this.cabinet, p).politicalHealth - v }))
        const e = tier.effects
        const impact = {
          mitigation: Math.max(0, -((e.coalitionEmissions ?? 0) + (e.nonMemberEmissions ?? 0))) + Math.max(0, -(e.methane ?? 0)) / 200,
          relief: Math.max(0, -(e.foodInsecure ?? 0)),
          resilience: (tier.adaptationValue ?? 0) + (tier.resilienceValue ?? 0) + (tier.resettleValue ?? 0),
        }
        out.push({
          policyId: policy.id, policyName: policy.name, summary: policyCopy(policy.id).summary,
          severity, cost, lag: tier.lag, effect: effectSummary(tier),
          selfCost: tier.politicalCost[this.seat] ?? 0, spill, impact,
          topples: spill.some((sp) => sp.resultHealth <= 0),
          selected: isSelected, disabled,
        })
      }
    }
    return out
  }

  budget(): number { return budgetFor(ministerOf(this.cabinet, this.seat)) }

  commit(playerMoves: Committed[]) {
    const you = ministerOf(this.cabinet, this.seat)
    // trade ledger + tally
    this.tradeLedger.push(tradeLine(playerMoves, this.seat, this.cabinet, this.round))
    const yourSpill = new Set<PortfolioId>()
    for (const mv of playerMoves) {
      const t = getTier(mv.policyId, mv.severity)
      this.did.emissions += Math.max(0, -((t.effects.coalitionEmissions ?? 0) + (t.effects.nonMemberEmissions ?? 0)))
      this.did.methane += Math.max(0, -(t.effects.methane ?? 0))
      this.did.relief += Math.max(0, -(t.effects.foodInsecure ?? 0))
      this.did.resilience += (t.adaptationValue ?? 0) + (t.resilienceValue ?? 0) + (t.resettleValue ?? 0)
      this.did.healthSpent += Math.max(0, t.politicalCost[this.seat] ?? 0)
      for (const [p, v] of Object.entries(t.politicalCost) as [PortfolioId, number][]) if (p !== this.seat && v > 0) yourSpill.add(p)
    }
    playerMoves.length ? this.did.roundsActed++ : this.did.roundsHeld++

    for (const mv of playerMoves) this.pipeline = enact(this.pipeline, mv.policyId, mv.severity, this.round, this.seat, you.generation)
    for (const mv of this.aiMoves) this.pipeline = enact(this.pipeline, mv.policyId, mv.severity, this.round, mv.by, ministerOf(this.cabinet, mv.by).generation)
    const committed = [...playerMoves, ...this.aiMoves]

    const landing = landDue(this.pipeline, this.round)
    this.pipeline = landing.pipeline
    const effects: Partial<PlanetState> = { ...landing.effects }
    for (const pulse of [this._ev.planetPulse, this.worldCard.planetPulse]) {
      if (!pulse) continue
      for (const [k, v] of Object.entries(pulse) as [keyof PlanetState, number][]) effects[k] = ((effects[k] as number) ?? 0) + v
    }
    const stepped = stepClimate(this.planet, this.acc, effects)
    this.planet = stepped.planet; this.acc = stepped.acc
    this.stocks = stepStocks(this.stocks, landing.landed)
    this.peakTemp = Math.max(this.peakTemp, this.planet.tempAnomaly)

    const external: ExternalPolitical = { byPortfolio: this.worldCard.healthDelta, cabinet: this.worldCard.cabinetHealthDelta }
    const pol = resolveRound(this.cabinet, this.round, committed, landing.landed, this._ev.domainShocks, external)
    this.cabinet = pol.cabinet
    this.successions.push(...pol.successions)
    this.instability = cabinetInstability(this.cabinet)

    const resolved = resolveDeaths(
      { round: this.round, planet: this.planet, stocks: this.stocks, shock: combineShocks(this._ev.disasterShocks), politicalInstability: this.instability, cabinetPointsUnspent: 0, unspentOptions: [] },
      this.deathModel,
    )
    this.deathModel = resolved.model
    this.ledger.push(resolved.entry)
    this.planet = { ...this.planet, cumulativeDeaths: resolved.entry.cumulative }

    const spillMap = new Map<PortfolioId, number>()
    for (const mv of playerMoves) for (const [p, v] of Object.entries(getTier(mv.policyId, mv.severity).politicalCost) as [PortfolioId, number][]) if (p !== this.seat && v !== 0) spillMap.set(p, (spillMap.get(p) ?? 0) + v)
    this.lastConsequence = {
      round: this.round, year: this.planet.year, total: resolved.entry.total, byChannel: resolved.entry.byChannel, cumulative: resolved.entry.cumulative,
      successions: pol.successions.map((s) => ({ portfolio: s.portfolio, cause: s.cause, archetype: s.archetype, byPlayer: yourSpill.has(s.portfolio) })),
      cabinetMoves: this.aiMoves.map((mv) => ({ seat: mv.by, name: getPolicy(mv.policyId).name, severity: mv.severity })),
      playerMoves: playerMoves.map((mv) => ({ name: getPolicy(mv.policyId).name, severity: mv.severity })),
      spilled: [...spillMap.entries()].map(([seat, amount]) => ({ seat, amount })),
    }
    for (const s of pol.successions) if (yourSpill.has(s.portfolio)) { this.did.toppled++; this.tradeLedger[this.round - 1] += `  ✖ cost ${SEAT_NAME[s.portfolio].split(' ')[0]} their office` }

    if (this.round >= 12) { this.settle(); this.phase = 'epilogue' }
    else { this.round++; this.beginRound() }
  }

  private settle() {
    for (let s = 1; s <= SETTLE_ROUNDS; s++) {
      const landing = landDue(this.pipeline, 12 + s)
      this.pipeline = landing.pipeline
      const stepped = stepClimate(this.planet, this.acc, landing.effects)
      this.planet = stepped.planet; this.acc = stepped.acc
      this.stocks = stepStocks(this.stocks, landing.landed)
      this.peakTemp = Math.max(this.peakTemp, this.planet.tempAnomaly)
      const resolved = resolveDeaths({ round: 12 + s, planet: this.planet, stocks: this.stocks, shock: null, politicalInstability: this.instability, cabinetPointsUnspent: 0, unspentOptions: [] }, this.deathModel)
      this.deathModel = resolved.model
      this.ledger.push(resolved.entry)
      this.planet = { ...this.planet, cumulativeDeaths: resolved.entry.cumulative }
    }
  }

  // --- narrative voice for the theatre ---
  diagnosis(): string[] {
    const p = this.planet
    const t = assessTargets(p, this.peakTemp)
    const hit = t.filter((x) => x.hit).length
    const lines: string[] = []
    const falling = this.peakTemp > p.tempAnomaly + 0.01
    lines.push(`It is ${2026 + 2 * this.round}. The planet holds at ${p.tempAnomaly.toFixed(2)}°C${falling ? ', just off its peak' : ' and climbing'}. The counter stands at ${(p.cumulativeDeaths / 1000).toFixed(2)} billion and has never once fallen.`)
    lines.push(`Your coalition emits ${p.coalitionEmissions.toFixed(0)} Gt and is yours to govern. The free-riders you cannot — ${p.nonMemberEmissions.toFixed(0)} Gt — drift upward regardless, and drag the whole world's temperature with them.`)
    if (p.foodInsecure > 600) lines.push(`${Math.round(p.foodInsecure)} million are food-insecure, past the line where the harvest itself begins to kill.`)
    else lines.push(`Food insecurity holds at ${Math.round(p.foodInsecure)} million — under the line, for now.`)
    lines.push(`${hit} of nine planetary targets are on track for the 2054 assessment.`)
    const frag = PORTFOLIOS.filter((pf) => pf !== this.seat && ministerOf(this.cabinet, pf).politicalHealth < 3)
    if (frag.length) lines.push(`Around the table, ${frag.map((f) => SEAT_NAME[f].split(' ')[0]).join(', ')} ${frag.length > 1 ? 'are each' : 'is'} one bad round from falling.`)
    else lines.push(`The cabinet, for now, holds together.`)
    return lines
  }

  // One compressed briefing, not a panel of separate voices — advisors who have seen the
  // events land, seen the trajectory, and are pleading with you to act on both. Every line
  // is grounded in this round's actual state: which event just hit, whether the emissions
  // target is slipping away, and a SPECIFIC affordable policy that answers the loudest
  // problem — the way a real chief of staff would put it in front of you, not a hint system.
  briefing(): Advisor[] {
    const you = ministerOf(this.cabinet, this.seat)
    const health = you.politicalHealth
    const fc = projectForecast(this.forecasts[this.seat], this.planet, this.acc, this.round)
    const menu = this.menu([])
    const targets = assessTargets(this.planet, this.peakTemp)
    const lines: string[] = []

    // --- 1. React to what just landed, by name, if it touches this seat's domain ---
    const relevant = this.events
      .map((e) => ({ e, plea: EVENT_PLEA[e.id] }))
      .filter((x): x is { e: EventCard; plea: EventPlea } => !!x.plea)
    const worst = relevant.sort((a, b) => (b.plea.severity ?? 0) - (a.plea.severity ?? 0))[0]
    if (worst) {
      lines.push(`${worst.e.name.toUpperCase()} — ${worst.plea.text}`)
    }

    // --- 2. The emissions trajectory, named and urgent, not buried in a table ---
    const emissionsTarget = targets.find((t) => t.name === 'Annual emissions')!
    const tempTarget = targets.find((t) => t.name === 'Peak temperature')!
    if (!emissionsTarget.hit && this.round >= 3) {
      const nonMemberDriven = this.planet.nonMemberEmissions > this.planet.coalitionEmissions * 1.3
      const ask = nonMemberDriven
        ? `We will not reach it alone — every point you can put behind diplomacy drags the free-riders down with us. Please, spend on that lever before it closes.`
        : `The cuts have to come from our own bloc, and they have to come now — every round we wait, the next one costs more.`
      lines.push(`We are not going to hit the emissions target at this rate — ${this.planet.annualEmissions.toFixed(0)} Gt global against a ceiling of 18, with ${12 - this.round} rounds left. ${ask}`)
    } else if (!tempTarget.hit && this.round >= 8) {
      lines.push(`The temperature has not turned over yet, and the rounds to bend it are almost gone. If it does not fall by the time we settle, it never will on our watch.`)
    }

    // --- 3. The forecast's own plea, only if it's saying something urgent ---
    if (fc.urgency > 0.55) {
      lines.push(`Your own forecast is no longer hedging: ${fc.headline} We beg you not to wait for certainty you will not get in time.`)
    }

    // --- 4. A single, specific, affordable recommendation — the ask, not a menu tour ---
    const priority: 'mitigation' | 'relief' | 'resilience' =
      worst?.plea.priority ?? (fc.emphasis === 'food' ? 'relief' : fc.emphasis === 'displacement' ? 'resilience' : 'mitigation')
    const available = menu.filter((t) => !t.disabled)
    const safe = available.filter((t) => !t.topples && t.impact[priority] > 0)
    const best = safe.sort((a, b) => b.impact[priority] / b.cost - a.impact[priority] / a.cost)[0]
    const boldest = available.filter((t) => t.topples).sort((a, b) => b.impact[priority] - a.impact[priority])[0]

    if (health < 3.5) {
      const healer = available.filter((t) => t.selfCost < 0).sort((a, b) => a.selfCost - b.selfCost)[0]
      lines.push(`You are at ${health.toFixed(1)} — please, protect yourself this round. ` + (healer ? `${healer.policyName} (${healer.severity}) rebuilds your standing before you spend it again.` : `Hold. A fall costs more than a quiet round.`))
    } else if (best) {
      let ask = `Do this: ${best.policyName} (${best.severity}) — ${best.cost} point${best.cost === 1 ? '' : 's'} buys ${describeImpact(priority, best.impact[priority])}.`
      if (boldest && boldest.impact[priority] > best.impact[priority] * 1.4) {
        const victim = boldest.spill.find((s) => s.resultHealth <= 0)!
        ask += ` ${boldest.policyName} (${boldest.severity}) would cut deeper, but it ends ${SEAT_NAME[victim.seat].split(' ')[0]}'s career to do it — only if you mean it.`
      }
      lines.push(ask)
    } else if (available.length > 0) {
      lines.push(`Nothing on the table moves the thing that most needs moving. We would rather you held than spent capital on a policy that does not answer it.`)
    } else {
      lines.push(`Nothing legal and affordable remains. You must hold, and we are sorry there is nothing better to offer.`)
    }

    return [{ name: 'YOUR ADVISORS', role: `${12 - this.round} rounds left`, lines }]
  }

  // --- read model for the UI ---
  snapshot() {
    const you = ministerOf(this.cabinet, this.seat)
    return {
      round: this.round, phase: this.phase, seat: this.seat, year: 2026 + 2 * this.round,
      counter: this.planet.cumulativeDeaths, peakTemp: this.peakTemp,
      planet: this.planet,
      targets: assessTargets(this.planet, this.peakTemp),
      you: { health: you.politicalHealth, gen: you.generation, budget: this.budget(), restrictions: you.restrictions, doctrine: you.doctrine },
      cabinet: PORTFOLIOS.filter((p) => p !== this.seat).map((p) => {
        const m = ministerOf(this.cabinet, p)
        return { portfolio: p, health: m.politicalHealth, gen: m.generation, band: band(m.politicalHealth), restriction: m.restrictions[0]?.forbidsFlag ?? null }
      }),
      forecast: projectForecast(this.forecasts[this.seat], this.planet, this.acc, this.round),
      events: this.events.map((c) => ({ name: c.name, feedback: c.kind === 'feedback', flavor: c.flavor })),
      worldCard: { name: this.worldCard.name, tone: this.worldCard.tone, flavor: this.worldCard.flavor },
      pulledForward: this.pulledForward,
      declarations: this.declarations,
      pipeline: this.pipelineView(),
      tradeLedger: this.tradeLedger,
      lastConsequence: this.lastConsequence,
    }
  }

  private pipelineView(): PipelineItem[] {
    return [...this.pipeline.pending].sort((a, b) => a.landsRound - b.landsRound).map((e) => {
      const inR = e.landsRound - this.round
      return {
        policyName: getPolicy(e.policyId).name, severity: e.severity, landsRound: e.landsRound,
        eta: e.landsRound > 14 ? 'too late' : inR <= 0 ? 'now' : `+${inR}`,
        by: e.enactedBy, mine: e.enactedBy === this.seat,
      }
    })
  }

  epilogue() {
    const chan: Record<string, number> = { heat: 0, food: 0, displacement: 0, disaster: 0, conflict: 0 }
    for (const e of this.ledger) for (const c of Object.keys(chan)) chan[c] += (e.byChannel as any)[c]
    const dominant = Object.keys(chan).reduce((a, b) => (chan[b]! > chan[a]! ? b : a)) as DeathChannel
    const vind = vindicatedSeat(this.forecasts, dominant)
    const targets = assessTargets(this.planet, this.peakTemp)
    const falling = this.planet.tempAnomaly < this.peakTemp - 0.01
    // project 20yr past 2054
    let p = this.planet, a = this.acc, y2074: PlanetState = p
    for (let i = 0; i < 10; i++) { const s = stepClimate(p, a, {}); p = s.planet; a = s.acc; if (p.year === 2074) y2074 = p }
    return {
      year: this.planet.year, planet: this.planet, peakTemp: this.peakTemp, falling,
      counter: this.planet.cumulativeDeaths,
      targets, targetsHit: targets.filter((t) => t.hit).length,
      falls: this.successions.length, dominant,
      vindSeat: vind.seat, vindEmphasis: vind.emphasis, vindName: this.forecasts[vind.seat].name,
      vindFell: ministerOf(this.cabinet, vind.seat).generation > 1,
      vindIsYou: vind.seat === this.seat,
      did: this.did, tradeLedger: this.tradeLedger,
      future: { year: 2074, temp: y2074.tempAnomaly, food: y2074.foodInsecure, unresettled: y2074.displacedUnresettled },
      preventable: namedPreventable(this.ledger),
    }
  }
}

// --- helpers ---
function band(h: number): string {
  return h >= 8 ? 'STRONG' : h >= 5 ? 'stable' : h >= 3 ? 'FRAGILE' : h >= 1 ? 'CRITICAL' : 'FALLEN'
}
function describeImpact(kind: 'mitigation' | 'relief' | 'resilience', v: number): string {
  if (kind === 'mitigation') return `~${v.toFixed(1)} Gt-equivalent of cuts`
  if (kind === 'relief') return `~${v.toFixed(0)}M off food insecurity`
  return `~${v.toFixed(0)} points of resilience`
}

function effectSummary(tier: import('../engine/types.ts').PolicyTier): string {
  const e = tier.effects
  const parts: string[] = []
  const add = (v: number | undefined, label: string, unit = '') => { if (v) parts.push(`${label} ${v > 0 ? '+' : ''}${v}${unit}`) }
  add(e.coalitionEmissions, 'coalition CO₂', ' Gt')
  add(e.nonMemberEmissions, 'non-member CO₂', ' Gt')
  add(e.methane, 'CH₄', ' ppb')
  add(e.foodInsecure, 'food', 'M')
  add(e.displacedUnresettled, 'unresettled', 'M')
  add(e.forestLossRate, 'forest', ' Mha')
  add(e.wetlandRestored, 'wetland', '%')
  if (tier.adaptationValue) parts.push(`+adapt ${tier.adaptationValue}`)
  if (tier.resilienceValue) parts.push(`+resil ${tier.resilienceValue}`)
  if (tier.resettleValue) parts.push(`resettle ${tier.resettleValue}M`)
  return parts.join(', ') || 'no direct planetary effect'
}
function tradeLine(moves: Committed[], seat: PortfolioId, cabinet: Cabinet, round: number): string {
  if (moves.length === 0) return `R${round}: held — traded a round of action for recovery. The counter rose regardless.`
  const bought: string[] = []; let youPay = 0; const others: string[] = []
  for (const mv of moves) {
    const t = getTier(mv.policyId, mv.severity); const e = t.effects
    if (e.coalitionEmissions && e.coalitionEmissions < 0) bought.push(`coalition CO₂ ${e.coalitionEmissions}`)
    if (e.nonMemberEmissions && e.nonMemberEmissions < 0) bought.push(`non-member CO₂ ${e.nonMemberEmissions}`)
    if (e.methane && e.methane < 0) bought.push(`methane ${e.methane}`)
    if (e.foodInsecure && e.foodInsecure < 0) bought.push(`food relief ${-e.foodInsecure}M`)
    if (t.resettleValue) bought.push(`resettle ${t.resettleValue}M`)
    if (t.adaptationValue || t.resilienceValue) bought.push(`+resil ${(t.adaptationValue ?? 0) + (t.resilienceValue ?? 0)}`)
    for (const [p, v] of Object.entries(t.politicalCost) as [PortfolioId, number][]) { if (v <= 0) continue; if (p === seat) youPay += v; else others.push(SEAT_NAME[p].split(' ')[0]) }
  }
  return `R${round}: bought ${bought.join(', ') || 'nothing'} ⟵ paid ${[youPay ? `${youPay} health` : '', ...new Set(others)].filter(Boolean).join(' + ') || 'nothing'}`
}
function namedPreventable(ledger: DeathLedgerEntry[]) {
  let best: { round: number; year: number; channel: string; policy: string; points: number; unspent: number; avoided: number } | null = null
  for (const e of ledger) for (const pv of e.preventable) if (!best || pv.deathsAvoidable > best.avoided) best = { round: e.round, year: e.year, channel: pv.channel, policy: pv.availablePolicy, points: pv.pointsRequired, unspent: pv.cabinetPointsUnspent, avoided: pv.deathsAvoidable }
  return best
}

export type { Minister }
