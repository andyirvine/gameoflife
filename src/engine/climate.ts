import type { PlanetState } from './types.ts'

// The physical world model. One round = two years.
//
// Temperature is split into two forcings so the design-doc behaviour falls out:
//   - a long-lived component that tracks CUMULATIVE emissions (TCRE-style) and only
//     ever rises on game timescales. This is the permanent floor under the climate.
//   - a short-lived component driven by methane, which can fall fast when methane
//     policy lands. This is what lets temperature "peak and then fall" (design doc)
//     even while CO2 plateaus, and it is why methane is the largest fast lever.
//
// Every constant that shapes an outcome lives here, at the top, so the whole model
// can be re-tuned in one place.

const YEARS_PER_ROUND = 2

// --- Temperature ---
const BASE_LONGLIVED_TEMP = 0.95        // °C, the CO2/long-lived share of the 1.3 baseline
const TCRE_SLOPE = 0.00052              // °C per GtCO2e cumulatively emitted since 2026
const METHANE_NATURAL = 700             // ppb, roughly pre-industrial
const SHORTLIVED_COEF = 0.0002846       // °C per ppb of methane above natural
//   check: 0.95 + 0.0002846*(1930-700) = 0.95 + 0.35 = 1.30 at baseline. good.

// --- CO2 accumulation ---
const PPM_PER_GT_ROUND = 0.12           // ppm added per GtCO2e of annual emissions, per round
//   40 Gt/yr -> ~4.8 ppm/round -> ~2.4 ppm/yr, plausible.

// --- Methane dynamics (short lifetime: responds within a round or two) ---
const METHANE_DRIFT = 22                // ppb/round of BAU upward pressure from sources
const METHANE_SINK = 0.06               // fractional relaxation toward natural each round

// --- Emissions drift (BAU creep absent policy), split by pool ---
// The coalition is already decarbonising, so its baseline creep is near-flat. The free-riding
// rest of the world is still industrialising, so it drifts up — this is the pressure the
// Foreign minister's diplomacy has to fight, and the reason domestic action alone can't win.
const COALITION_DRIFT = 0.1             // GtCO2e/round
const NONMEMBER_DRIFT = 0.35            // GtCO2e/round — free-riding growth (still rises, but draggable)

// --- Human-impact couplings ---
const FOOD_TEMP_THRESHOLD = 1.3         // °C above which warming pushes food insecurity
const FOOD_TEMP_COEF = 240              // millions more food-insecure per °C-round over threshold
const FOOD_FOREST_COEF = 6              // millions per M-ha/yr of forest loss, per round
const FOOD_DRIFT = 8                    // millions/round BAU creep

const DISPLACE_TEMP_THRESHOLD = 1.2
const DISPLACE_TEMP_COEF = 26           // millions/year additional displacement per °C over threshold
const DISPLACE_BASE_RESETTLE = 6        // millions/round the system reabsorbs on its own

const DAMAGES_TEMP_COEF = 2.4           // %GDP damages per °C over 1.3
const BIODIVERSITY_TEMP_DECAY = 1.1     // index points lost per °C-round over 1.3
const CORAL_TEMP_DECAY = 3.0            // % of 1990 lost per °C-round over 1.3
const SEALEVEL_PER_ROUND = 0.9          // cm/round baseline, scaled by temperature
const OCEAN_PH_PER_PPM = 0.00007        // pH drop per ppm CO2 rise

// Cumulative emissions since 2026, needed for the long-lived temperature term.
// Kept alongside PlanetState in the loop rather than inside it, to keep PlanetState
// a pure snapshot of readings.
export type ClimateAccumulators = {
  cumulativeEmitted: number  // GtCO2e emitted since 2026
}

export function initAccumulators(): ClimateAccumulators {
  return { cumulativeEmitted: 0 }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

// Advance the planet one round. Pure: returns a new PlanetState + accumulators,
// mutates nothing. `effectsApplied` is the sum of pipeline deltas that landed this
// round (emissions cuts, methane cuts, forest protection, etc.), already merged.
export function stepClimate(
  prev: PlanetState,
  acc: ClimateAccumulators,
  effectsApplied: Partial<PlanetState>,
): { planet: PlanetState; acc: ClimateAccumulators } {
  // 1. Emissions, split by pool. Domestic policy cuts coalitionEmissions; diplomacy cuts
  //    nonMemberEmissions; physical feedback pulses (permafrost, Amazon) carry a raw
  //    annualEmissions delta and land on the uncontrolled non-member pool.
  const coalitionEmissions = Math.max(
    0,
    prev.coalitionEmissions + COALITION_DRIFT + (effectsApplied.coalitionEmissions ?? 0),
  )
  const nonMemberEmissions = Math.max(
    0,
    prev.nonMemberEmissions + NONMEMBER_DRIFT +
      (effectsApplied.nonMemberEmissions ?? 0) + (effectsApplied.annualEmissions ?? 0),
  )
  const annualEmissions = coalitionEmissions + nonMemberEmissions

  // 2. Accumulate emissions and CO2 concentration over the two-year round.
  const emittedThisRound = annualEmissions * YEARS_PER_ROUND
  const cumulativeEmitted = acc.cumulativeEmitted + emittedThisRound
  const co2 = prev.co2 + annualEmissions * PPM_PER_GT_ROUND + (effectsApplied.co2 ?? 0)

  // 3. Methane: drift up, relax toward natural, plus landed policy delta.
  const methane = Math.max(
    METHANE_NATURAL,
    prev.methane +
      METHANE_DRIFT -
      METHANE_SINK * (prev.methane - METHANE_NATURAL) +
      (effectsApplied.methane ?? 0),
  )

  // 4. Temperature: permanent long-lived floor + fast short-lived methane term.
  const longLived = BASE_LONGLIVED_TEMP + TCRE_SLOPE * cumulativeEmitted
  const shortLived = SHORTLIVED_COEF * (methane - METHANE_NATURAL)
  const tempAnomaly = longLived + shortLived + (effectsApplied.tempAnomaly ?? 0)

  const overFood = Math.max(0, tempAnomaly - FOOD_TEMP_THRESHOLD)
  const overDisplace = Math.max(0, tempAnomaly - DISPLACE_TEMP_THRESHOLD)
  const overDamages = Math.max(0, tempAnomaly - 1.3)

  // 5. Forest loss: policy-driven, else holds at baseline.
  const forestLossRate = Math.max(
    0,
    prev.forestLossRate + (effectsApplied.forestLossRate ?? 0),
  )

  // 6. Food insecurity: warming + forest loss + BAU creep, minus landed relief effects.
  const foodInsecure = Math.max(
    0,
    prev.foodInsecure +
      FOOD_TEMP_COEF * overFood * (YEARS_PER_ROUND / 2) +
      FOOD_FOREST_COEF * forestLossRate * (YEARS_PER_ROUND / 2) / 5 +
      FOOD_DRIFT +
      (effectsApplied.foodInsecure ?? 0),
  )

  // 7. Displacement flow and the unresettled stock (deaths key off the stock).
  const displacedAnnual = Math.max(
    0,
    30 + DISPLACE_TEMP_COEF * overDisplace + (effectsApplied.displacedAnnual ?? 0),
  )
  const newlyDisplaced = displacedAnnual * YEARS_PER_ROUND
  const displacedUnresettled = Math.max(
    0,
    prev.displacedUnresettled +
      newlyDisplaced -
      DISPLACE_BASE_RESETTLE +
      (effectsApplied.displacedUnresettled ?? 0),
  )

  // 8. Slow-moving world-report metrics.
  const wetlandRestored = prev.wetlandRestored + (effectsApplied.wetlandRestored ?? 0)
  const biodiversityIndex = clamp(
    prev.biodiversityIndex -
      BIODIVERSITY_TEMP_DECAY * overDamages +
      (effectsApplied.biodiversityIndex ?? 0),
    0,
    100,
  )
  const coralExtent = clamp(
    prev.coralExtent - CORAL_TEMP_DECAY * overDamages + (effectsApplied.coralExtent ?? 0),
    0,
    100,
  )
  const seaLevelRise =
    prev.seaLevelRise + SEALEVEL_PER_ROUND * (1 + overDamages) + (effectsApplied.seaLevelRise ?? 0)
  const oceanPh = prev.oceanPh - OCEAN_PH_PER_PPM * (co2 - prev.co2) + (effectsApplied.oceanPh ?? 0)
  const damagesPctGdp = Math.max(
    0,
    2 + DAMAGES_TEMP_COEF * overDamages + (effectsApplied.damagesPctGdp ?? 0),
  )

  const planet: PlanetState = {
    year: prev.year + YEARS_PER_ROUND,
    tempAnomaly,
    co2,
    annualEmissions,
    coalitionEmissions,
    nonMemberEmissions,
    methane,
    forestLossRate,
    wetlandRestored,
    biodiversityIndex,
    coralExtent,
    seaLevelRise,
    oceanPh,
    displacedAnnual,
    displacedUnresettled,
    foodInsecure,
    damagesPctGdp,
    cumulativeDeaths: prev.cumulativeDeaths, // deaths added by the death model, not here
  }

  return { planet, acc: { cumulativeEmitted } }
}
