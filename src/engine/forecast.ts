import type { DeathChannel, PlanetState, PortfolioId } from './types.ts'
import type { Rng } from './rng.ts'
import { stepClimate, type ClimateAccumulators } from './climate.ts'
import { EVENTS_DECK, drawProbability } from './events-deck.ts'

// Forecasts. Six models, one per seat, issued at game start.
//
// They are all ACCURATE — none is biased or wrong. What differs is what each one
// FOREGROUNDS and how alarmed it is: one treats tipping points as the risk that dwarfs all
// others, another counts the human toll first, another trusts the transition and warns
// against moving faster than the economy can bear. Like the spread across real climate
// scenarios, every reading is legitimate; they weight different risks and express different
// levels of concern. The forecast is a guiding worldview, not a gamble on who is right.
//
// A forecast re-anchors to observed reality each round, and its confidence band narrows as
// the mandate runs — wide error bars early, tight late. You get certainty exactly as you run
// out of room to use it.
//
// The forecast belongs to the OFFICE, not the person — a successor inherits the seat's model.
// The epilogue does not crown a "correct" model; it names which LENS turned out to matter —
// the one that foregrounded the risk that ended up doing the killing.

export type ForecastEmphasis = 'feedback' | 'displacement' | 'food' | 'heat' | 'economic' | 'balanced'

export type ForecastModel = {
  id: string
  name: string
  emphasis: ForecastEmphasis
  concern: number   // alarm multiplier ~0.9..1.25; all are valid, none is "wrong"
  creed: string     // the model's worldview, one line
}

const MODELS: ForecastModel[] = [
  { id: 'baseline', name: 'Baseline Consensus', emphasis: 'balanced', concern: 1.0,
    creed: 'Reads the central case straight, with no thumb on the scale.' },
  { id: 'precautionary', name: 'Precautionary Watch', emphasis: 'feedback', concern: 1.25,
    creed: 'Treats tipping points as the risk that dwarfs all others, and acts before they fire.' },
  { id: 'humanitarian', name: 'Humanitarian Lens', emphasis: 'displacement', concern: 1.15,
    creed: 'Counts the toll in people moved and unhoused, and refuses to discount it.' },
  { id: 'managed', name: 'Managed Transition', emphasis: 'economic', concern: 0.9,
    creed: 'Trusts the transition to compound, and warns against moving faster than the economy can bear.' },
  { id: 'thermal', name: 'Thermal Line', emphasis: 'heat', concern: 1.1,
    creed: 'Watches the temperature above all; heat is what kills at scale.' },
  { id: 'grain', name: 'Grain & Water', emphasis: 'food', concern: 1.1,
    creed: 'Foregrounds the harvest; food failure is the first and deadliest domino.' },
]

const ALL_PORTFOLIOS: PortfolioId[] = [
  'energy', 'agriculture', 'treasury', 'foreign', 'environment', 'resilience',
]

export function assignForecasts(rng: Rng): Record<PortfolioId, ForecastModel> {
  const shuffled = [...MODELS]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }
  const out = {} as Record<PortfolioId, ForecastModel>
  ALL_PORTFOLIOS.forEach((p, i) => { out[p] = shuffled[i]! })
  return out
}

function clamp(x: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, x)) }

// The accurate, model-neutral read of how urgent action is, 0..1.
function baseUrgency(planet: PlanetState): number {
  const warmingDrive = clamp((planet.tempAnomaly - 1.3) / 0.7, 0, 1)
  const feedbackDrive = clamp((planet.tempAnomaly - 1.4) / 0.5, 0, 1)
  return 0.5 * warmingDrive + 0.5 * feedbackDrive
}

// The stress on whatever dimension a model foregrounds, 0..1 — all read from real state.
function emphasisSignal(emphasis: ForecastEmphasis, p: PlanetState): number {
  switch (emphasis) {
    case 'feedback': return clamp((p.tempAnomaly - 1.4) / 0.5, 0, 1)
    case 'displacement': return clamp(p.displacedUnresettled / 300, 0, 1)
    case 'food': return clamp((p.foodInsecure - 600) / 900, 0, 1)
    case 'heat': return clamp((p.tempAnomaly - 1.5) / 0.4, 0, 1)
    case 'economic': return clamp((p.damagesPctGdp - 2) / 6, 0, 1)
    case 'balanced': return baseUrgency(p)
  }
}

// How urgently this model says to act, 0..1. Accurate base, tilted toward the model's
// emphasis and scaled by its concern. All legitimate; they simply weight risk differently.
export function perceivedUrgency(f: ForecastModel, planet: PlanetState): number {
  const u = (0.6 * baseUrgency(planet) + 0.4 * emphasisSignal(f.emphasis, planet)) * f.concern
  return clamp(u, 0, 1)
}

// The confidence band (± °C) on this round's projections. Wide early, narrow late.
export function forecastBand(round: number): number {
  return Math.round((0.30 * (1 - (round - 1) / 11) + 0.05) * 100) / 100
}
export function forecastConfidence(round: number): number {
  return clamp(0.35 + ((round - 1) / 11) * 0.6, 0, 0.95)
}

// The detailed forecast: a forward projection under the current trajectory (no new policy),
// re-anchored to where the planet actually is now, framed by the model's emphasis.
export type ForecastReadout = {
  name: string
  creed: string
  emphasis: ForecastEmphasis
  concernLabel: string
  confidence: number
  band: number
  urgency: number
  checkpoints: { year: number; temp: number; foodInsecure: number; unresettled: number }[]
  feedbackWatch: { name: string; oddsNow: number; oddsEnd: number }[]
  headline: string
}

export function projectForecast(
  f: ForecastModel, planet: PlanetState, acc: ClimateAccumulators, round: number,
): ForecastReadout {
  // Project physical trajectory forward with no new policy — "if the current path holds".
  // Re-anchoring to the real `planet` each round means landed policy is already reflected.
  let p = planet
  let a = acc
  const wantYears = new Set([round + 2, round + 4, 12].filter((r) => r > round && r <= 12).map((r) => 2026 + 2 * r))
  const checkpoints: ForecastReadout['checkpoints'] = []
  for (let r = round + 1; r <= 12; r++) {
    const stepped = stepClimate(p, a, {})
    p = stepped.planet; a = stepped.acc
    if (wantYears.has(p.year)) {
      checkpoints.push({ year: p.year, temp: p.tempAnomaly, foodInsecure: p.foodInsecure, unresettled: p.displacedUnresettled })
    }
  }
  const endPlanet = p

  const feedbackWatch = EVENTS_DECK.filter((c) => c.kind === 'feedback')
    .map((c) => ({ name: c.name, oddsNow: drawProbability(c, planet), oddsEnd: drawProbability(c, endPlanet) }))
    .sort((x, y) => y.oddsEnd - x.oddsEnd)
    .slice(0, 2)

  const concernLabel = f.concern >= 1.15 ? 'HIGH concern' : f.concern >= 1.0 ? 'elevated concern' : 'measured concern'
  const headline = buildHeadline(f, endPlanet, feedbackWatch)

  return {
    name: f.name, creed: f.creed, emphasis: f.emphasis, concernLabel,
    confidence: forecastConfidence(round), band: forecastBand(round),
    urgency: perceivedUrgency(f, planet), checkpoints, feedbackWatch, headline,
  }
}

function buildHeadline(f: ForecastModel, end: PlanetState, fb: ForecastReadout['feedbackWatch']): string {
  const endYear = end.year
  const topFb = fb[0]
  switch (f.emphasis) {
    case 'feedback':
      return `Tipping risk is the number that matters: on this path ${topFb?.name ?? 'the lead feedback'} reaches ~${Math.round((topFb?.oddsEnd ?? 0) * 100)}% odds by ${endYear}. Act before it fires.`
    case 'displacement':
      return `The toll is in people: ~${Math.round(end.displacedUnresettled)}M left unresettled by ${endYear} unless the trajectory bends. Resettlement now is worth more than it looks.`
    case 'food':
      return `The harvest goes first: ~${Math.round(end.foodInsecure)}M food-insecure by ${endYear} on this path. Relief buys lives cheaply and early.`
    case 'heat':
      return `Watch the line: ~${end.tempAnomaly.toFixed(2)}°C by ${endYear} on the current trajectory. Heat mortality climbs non-linearly past 1.6°C.`
    case 'economic':
      return `The transition can carry this if you do not overreach: ~${end.tempAnomaly.toFixed(2)}°C and ${end.damagesPctGdp.toFixed(1)}% damages by ${endYear}. Pace the cuts to what the economy bears.`
    case 'balanced':
      return `Central case: ~${end.tempAnomaly.toFixed(2)}°C, ${Math.round(end.foodInsecure)}M food-insecure, ${Math.round(end.displacedUnresettled)}M unresettled by ${endYear} if the path holds.`
  }
}

// Which lens turned out to matter: the model foregrounding the channel that did the most
// killing. Returns the seat holding it (the epilogue's reframed "who to have listened to").
const CHANNEL_TO_EMPHASIS: Record<DeathChannel, ForecastEmphasis> = {
  heat: 'heat', food: 'food', displacement: 'displacement', disaster: 'feedback', conflict: 'food',
}

export function vindicatedSeat(
  forecasts: Record<PortfolioId, ForecastModel>, dominantChannel: DeathChannel,
): { seat: PortfolioId; emphasis: ForecastEmphasis } {
  const want = CHANNEL_TO_EMPHASIS[dominantChannel]
  const match = ALL_PORTFOLIOS.find((p) => forecasts[p].emphasis === want)
  const seat = match ?? ALL_PORTFOLIOS.find((p) => forecasts[p].emphasis === 'balanced') ?? 'resilience'
  return { seat, emphasis: want }
}
