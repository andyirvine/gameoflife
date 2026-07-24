import type {
  DeathChannel,
  DeathLedgerEntry,
  MitigationStocks,
  PlanetState,
  PolicyTier,
  PreventableMoment,
  Severity,
} from './types.ts'

// The death toll model. The most important part of the build.
//
// Deaths are never one opaque formula. They are the sum of five named channels, each a
// pure function of the world state, each logged every round so the epilogue can name the
// exact round the cabinet traded lives for trajectory. There is no "lives saved" counter
// anywhere; cumulativeDeaths only ever rises.
//
// Two decaying stocks — adaptation and resilience — are the ONLY things that damp the
// channels. That is what makes "we should have built the flood defences" mechanically
// true rather than flavour text.
//
// Every constant that shapes a number lives at the top of this file.

// --- Heat: non-linear (logistic) in temperature, flat below ~1.4, steep above ~1.6 ---
const HEAT_SCALE = 50          // millions/round at full saturation, uncovered
const HEAT_MID = 1.65          // °C, logistic midpoint
const HEAT_WIDTH = 0.12        // °C, logistic width
const HEAT_COVER_MAX = 0.6     // adaptation can never cover more than 60% of heat deaths
const HEAT_COVER_HALF = 12     // adaptation stock at which cover is half of the max

// --- Food: convex above a threshold, the channel most responsive to policy and the one
//     most often sacrificed for emissions progress, so it carries the heavier weight ---
const FOOD_THRESHOLD = 600     // millions food-insecure below which food deaths ~ 0
const FOOD_K = 12              // scale
const FOOD_EXP = 1.25          // convexity

// --- Displacement: scales with the UNRESETTLED stock, damped by resilience.
//     Deliberately lighter than food so it does not sit on top of every neglect run ---
const DISP_K = 0.19            // millions dead/round per million unresettled, uncovered
const DISP_COVER_MAX = 0.5
const DISP_COVER_HALF = 14

// --- Disaster: event-driven, damped by adaptation (+ half of resilience) ---
const DISASTER_ADAPT_HALF = 10 // adaptation stock at which disaster cover is half of max
const DISASTER_COVER_MAX = 0.7

// --- Conflict: STATEFUL. Slow to start, slower to stop, hard to reverse ---
const CONFLICT_THRESHOLD = 0.15   // pressure above which intensity climbs
const CONFLICT_RISE = 0.55        // how fast intensity climbs past threshold
const CONFLICT_DECAY = 0.12       // how fast it fades once pressure drops (~1/4 of rise)
const CONFLICT_K = 120            // millions/round at full intensity
const CONFLICT_CAP_FRACTION = 0.25 // conflict may not exceed 25% of the round total

// --- Plausibility saturation: a two-year round can't kill an impossible number of people ---
const ROUND_DEATH_KNEE = 220         // millions/round beyond which extra deaths compress
const ROUND_DEATH_COMPRESSION = 0.22 // fraction of raw deaths above the knee that still count

// Carried across rounds — conflict has memory, nothing else does.
export type DeathModelState = {
  conflictIntensity: number   // 0..1
}

export function initDeathModel(): DeathModelState {
  return { conflictIntensity: 0 }
}

// A physical shock surfaced by the Events Deck (step 6). Until then the driver supplies
// it directly. `magnitude` is base millions at risk before adaptation cover.
export type DisasterShock = {
  label: string
  magnitude: number
  // exposure 0..1: how much of the shock actually reaches people this round.
  exposure: number
}

// Everything the death model needs that is not in PlanetState. The full game supplies
// real values in later steps; the ledger demo constructs these directly.
export type DeathContext = {
  round: number
  planet: PlanetState
  stocks: MitigationStocks
  shock: DisasterShock | null
  // Mean cabinet fragility, 0 (rock solid) .. 1 (collapsing). Step 5 computes it from
  // political health; the demo supplies a scenario value.
  politicalInstability: number
  // For the preventable calculation: points the cabinet left unspent this round, and the
  // affordable tiers that were on an available menu but not enacted.
  cabinetPointsUnspent: number
  unspentOptions: AvailableOption[]
}

export type AvailableOption = {
  policyId: string
  policyName: string
  severity: Severity
  tier: PolicyTier
}

function cover(stock: number, half: number, max: number): number {
  return (max * stock) / (stock + half)
}

// --- The five channels, each pure, each independently testable ---

export function heatDeaths(planet: PlanetState, stocks: MitigationStocks): number {
  const logistic = HEAT_SCALE / (1 + Math.exp(-(planet.tempAnomaly - HEAT_MID) / HEAT_WIDTH))
  return logistic * (1 - cover(stocks.adaptation, HEAT_COVER_HALF, HEAT_COVER_MAX))
}

export function foodDeaths(planet: PlanetState): number {
  const over = Math.max(0, (planet.foodInsecure - FOOD_THRESHOLD) / 100)
  return FOOD_K * Math.pow(over, FOOD_EXP)
}

export function displacementDeaths(planet: PlanetState, stocks: MitigationStocks): number {
  return (
    DISP_K *
    planet.displacedUnresettled *
    (1 - cover(stocks.resilience, DISP_COVER_HALF, DISP_COVER_MAX))
  )
}

export function disasterDeaths(shock: DisasterShock | null, stocks: MitigationStocks): number {
  if (!shock) return 0
  const effectiveAdapt = stocks.adaptation + 0.5 * stocks.resilience
  const c = cover(effectiveAdapt, DISASTER_ADAPT_HALF, DISASTER_COVER_MAX)
  return shock.magnitude * shock.exposure * (1 - c)
}

// Governance fragility floor: even a popular, electorally-stable cabinet cannot hold order
// under extreme resource collapse. This is why a do-nothing cabinet — politically serene
// because it never does anything unpopular — still gets conflict as famine and displacement
// mount. Cabinet instability adds on top of it.
const GOVERNANCE_FLOOR = 0.35

// Conflict pressure: resource stress (food + displacement) times governance fragility, where
// fragility is the floor plus whatever electoral instability the cabinet has on top.
export function conflictPressure(planet: PlanetState, instability: number): number {
  const foodStress = Math.min(1, Math.max(0, (planet.foodInsecure - FOOD_THRESHOLD) / 800))
  const dispStress = Math.min(1, planet.displacedUnresettled / 200)
  const resourceStress = 0.6 * foodStress + 0.4 * dispStress
  const fragility = Math.min(1, GOVERNANCE_FLOOR + instability)
  return resourceStress * fragility
}

// Advance conflict intensity (stateful). Returns the new intensity.
export function stepConflict(prevIntensity: number, pressure: number): number {
  let intensity = prevIntensity
  if (pressure > CONFLICT_THRESHOLD) {
    intensity += CONFLICT_RISE * (pressure - CONFLICT_THRESHOLD)
  } else {
    intensity *= 1 - CONFLICT_DECAY
  }
  return Math.min(1, Math.max(0, intensity))
}

// The whole round: compute every channel, update conflict memory, build the ledger entry.
export function resolveDeaths(
  ctx: DeathContext,
  model: DeathModelState,
): { entry: DeathLedgerEntry; model: DeathModelState } {
  const { planet, stocks } = ctx

  const heat = heatDeaths(planet, stocks)
  const food = foodDeaths(planet)
  const displacement = displacementDeaths(planet, stocks)
  const disaster = disasterDeaths(ctx.shock, stocks)

  const pressure = conflictPressure(planet, ctx.politicalInstability)
  const conflictIntensity = stepConflict(model.conflictIntensity, pressure)
  let conflict = CONFLICT_K * conflictIntensity

  // Conflict may not swamp the round: cap at 25% of the total (see design brief).
  const others = heat + food + displacement + disaster
  const conflictCap = (others * CONFLICT_CAP_FRACTION) / (1 - CONFLICT_CAP_FRACTION)
  if (conflict > conflictCap) conflict = conflictCap

  // A single two-year round cannot kill an implausible share of the living. Past a knee, extra
  // modelled deaths compress hard — so a runaway still gets much worse than a managed world,
  // but the cumulative counter stays inside the bounds of the physically possible rather than
  // exceeding the global population. Channels scale together so the breakdown stays honest.
  const rawTotal = heat + food + displacement + disaster + conflict
  const scale = rawTotal > ROUND_DEATH_KNEE
    ? (ROUND_DEATH_KNEE + (rawTotal - ROUND_DEATH_KNEE) * ROUND_DEATH_COMPRESSION) / rawTotal
    : 1

  const byChannel: Record<DeathChannel, number> = {
    heat: round1(heat * scale),
    food: round1(food * scale),
    displacement: round1(displacement * scale),
    disaster: round1(disaster * scale),
    conflict: round1(conflict * scale),
  }
  const total = round1(rawTotal * scale)

  const drivers = describeDrivers(ctx, byChannel, conflictIntensity)
  const preventable = findPreventable(ctx, byChannel)

  const entry: DeathLedgerEntry = {
    round: ctx.round,
    year: planet.year,
    byChannel,
    total,
    cumulative: round1(planet.cumulativeDeaths + total),
    drivers,
    preventable,
  }
  return { entry, model: { conflictIntensity } }
}

// --- Preventability: derived from the same channel functions that did the killing ---
//
// For each channel with meaningful deaths, find the cheapest affordable unspent tier that
// would have damped it, and estimate the deaths it would have avoided THIS round by
// re-running that channel with the tier's stock/effect applied. No hand-authored list.

const PREVENTABLE_MIN_FRACTION = 0.01 // must cut > 1% of the round total to be logged

function findPreventable(
  ctx: DeathContext,
  byChannel: Record<DeathChannel, number>,
): PreventableMoment[] {
  const total = Object.values(byChannel).reduce((a, b) => a + b, 0)
  if (total <= 0) return []
  const out: PreventableMoment[] = []

  for (const channel of ['heat', 'food', 'displacement', 'disaster', 'conflict'] as DeathChannel[]) {
    if (byChannel[channel] <= 0) continue
    let best: { opt: AvailableOption; avoided: number } | null = null

    for (const opt of ctx.unspentOptions) {
      if (opt.tier.pointCost > ctx.cabinetPointsUnspent) continue
      const avoided = counterfactualReduction(channel, ctx, opt.tier)
      if (avoided <= 0) continue
      if (!best || opt.tier.pointCost < best.opt.tier.pointCost ||
          (opt.tier.pointCost === best.opt.tier.pointCost && avoided > best.avoided)) {
        best = { opt, avoided }
      }
    }

    if (best && best.avoided >= total * PREVENTABLE_MIN_FRACTION) {
      out.push({
        channel,
        availablePolicy: `${best.opt.policyName} (${best.opt.severity})`,
        pointsRequired: best.opt.tier.pointCost,
        cabinetPointsUnspent: ctx.cabinetPointsUnspent,
        deathsAvoidable: round1(best.avoided),
      })
    }
  }
  return out
}

// How many deaths in `channel` this round would a given tier have avoided, applied now?
function counterfactualReduction(
  channel: DeathChannel,
  ctx: DeathContext,
  tier: PolicyTier,
): number {
  const { planet, stocks } = ctx
  switch (channel) {
    case 'heat': {
      if (!tier.adaptationValue) return 0
      const boosted = { ...stocks, adaptation: stocks.adaptation + tier.adaptationValue }
      return heatDeaths(planet, stocks) - heatDeaths(planet, boosted)
    }
    case 'displacement': {
      const boostedRes = tier.resilienceValue
        ? { ...stocks, resilience: stocks.resilience + tier.resilienceValue }
        : stocks
      const clearedStock = tier.resettleValue
        ? { ...planet, displacedUnresettled: Math.max(0, planet.displacedUnresettled - tier.resettleValue) }
        : planet
      return displacementDeaths(planet, stocks) - displacementDeaths(clearedStock, boostedRes)
    }
    case 'food': {
      const relief = tier.effects.foodInsecure ?? 0
      if (relief >= 0) return 0 // only relief (negative delta) helps
      const relieved = { ...planet, foodInsecure: Math.max(0, planet.foodInsecure + relief) }
      return foodDeaths(planet) - foodDeaths(relieved)
    }
    case 'disaster': {
      if (!ctx.shock) return 0
      if (!tier.adaptationValue && !tier.resilienceValue) return 0
      const boosted = {
        adaptation: stocks.adaptation + (tier.adaptationValue ?? 0),
        resilience: stocks.resilience + (tier.resilienceValue ?? 0),
      }
      return disasterDeaths(ctx.shock, stocks) - disasterDeaths(ctx.shock, boosted)
    }
    case 'conflict':
      // Conflict has memory and can't be cut within the round it fires. Its preventable
      // moment is upstream (relief/resettlement that eases resource stress); we surface
      // that via the food and displacement channels rather than double-counting here.
      return 0
  }
}

// --- Human-readable drivers for the verbose ledger ---

function describeDrivers(
  ctx: DeathContext,
  byChannel: Record<DeathChannel, number>,
  conflictIntensity: number,
): string[] {
  const { planet, stocks } = ctx
  const d: string[] = []
  if (byChannel.heat > 0) {
    const c = Math.round(cover(stocks.adaptation, HEAT_COVER_HALF, HEAT_COVER_MAX) * 100)
    d.push(`heat: ${planet.tempAnomaly.toFixed(2)}°C, adaptation covering ${c}%`)
  }
  if (byChannel.food > 0) {
    d.push(`food: ${Math.round(planet.foodInsecure)}M insecure vs ${FOOD_THRESHOLD}M threshold`)
  }
  if (byChannel.displacement > 0) {
    const c = Math.round(cover(stocks.resilience, DISP_COVER_HALF, DISP_COVER_MAX) * 100)
    d.push(`displacement: ${Math.round(planet.displacedUnresettled)}M unresettled, resilience covering ${c}%`)
  }
  if (byChannel.disaster > 0 && ctx.shock) {
    d.push(`disaster: ${ctx.shock.label}`)
  }
  if (byChannel.conflict > 0) {
    d.push(`conflict: intensity ${conflictIntensity.toFixed(2)} on food + displacement stress`)
  }
  return d
}

function round1(x: number): number {
  return Math.round(x * 10) / 10
}
