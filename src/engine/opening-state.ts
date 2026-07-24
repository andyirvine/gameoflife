import type { PlanetState } from './types.ts'

// Canonical frozen 2026 baseline. Values sourced to the design doc's opening-state and
// target tables, with the physical readings set to plausible 2026 figures.
//
// This is deliberately behind a function returning a fresh object so the live data
// loader (Scripps/NOAA, Copernicus, Global Carbon Project, NSIDC, GFW) can be swapped
// in later without any other file changing. Nothing here reads the network today.
const CANONICAL_2026: Readonly<PlanetState> = Object.freeze({
  year: 2026,
  tempAnomaly: 1.3,          // °C above pre-industrial (design doc baseline)
  co2: 426,                  // ppm, Mauna Loa order of magnitude
  annualEmissions: 40,       // GtCO2e (design doc baseline) = coalition + nonMember
  coalitionEmissions: 12,    // ~30% of global — EU + the willing, directly governable
  nonMemberEmissions: 28,    // ~70% — the free-riding rest, bends only to diplomacy
  methane: 1930,             // ppb
  forestLossRate: 10,        // M ha/year (design doc baseline)
  wetlandRestored: 0,        // % vs baseline
  biodiversityIndex: 30,     // 0-100, 30 at baseline (design doc)
  coralExtent: 50,           // % of 1990, already halved and falling
  seaLevelRise: 24,          // cm cumulative since ~1900
  oceanPh: 8.05,
  displacedAnnual: 30,       // millions/year (design doc baseline)
  displacedUnresettled: 32,  // millions cumulative already stranded
  foodInsecure: 735,         // millions (design doc baseline)
  damagesPctGdp: 2,          // % of GDP (design doc baseline)
  cumulativeDeaths: 0,       // the counter starts at zero for the 2026-onward mandate
})

// Returns a fresh, mutable copy of the canonical opening state.
export function loadOpeningState(): PlanetState {
  return { ...CANONICAL_2026 }
}
