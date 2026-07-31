import type { PlanetState } from './types.ts'

// Canonical frozen 2026 baseline. These are hardcoded figures, not fetched from any live
// source — most started as the design doc's placeholder numbers, with the physical readings
// (CO2, methane) later nudged to plausible real-world values. Only tempAnomaly and
// cumulativeDeaths carry an explicit citation below; treat everything else here as
// illustrative, not sourced.
//
// This sits behind a function returning a fresh object so a real live-data loader (Scripps/
// NOAA, Copernicus, Global Carbon Project, NSIDC, GFW) could be swapped in later without any
// other file changing — but no such loader exists yet, and nothing here reads the network.
const CANONICAL_2026: Readonly<PlanetState> = Object.freeze({
  year: 2026,
  tempAnomaly: 1.5,          // °C above pre-industrial. Copernicus/WMO put single calendar
                             // years 2023-2024 at ~1.48-1.55°C; the design doc's original
                             // 1.3°C tracked the slower decadal-average trend and was stale.
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
  // Deaths prior to this mandate, seeded from a cited external estimate — NOT computed by
  // this engine's own death model, and deliberately small next to what the mandate itself
  // will add. Source: V20 (Vulnerable Twenty Group of Finance Ministers), climate-related
  // disasters in the most climate-vulnerable economies, 2000-2019: over 1.2 million deaths.
  // This is a partial, disaster-only figure for the most exposed economies, not a
  // comprehensive global all-cause estimate — no such figure is scientifically settled, so
  // none is claimed here. From this point on the counter is the engine's own model.
  cumulativeDeaths: 1.2,     // millions; ~1.2M per the V20 2000-2019 estimate above
})

// Returns a fresh, mutable copy of the canonical opening state.
export function loadOpeningState(): PlanetState {
  return { ...CANONICAL_2026 }
}
