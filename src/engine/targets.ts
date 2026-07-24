import type { PlanetState } from './types.ts'

// The nine planetary targets, assessed at the final round. Hitting most produces a survivable
// ending; hitting few does not. Design-doc table.
//
// These are game rules (the thresholds), so they live in the engine as one source of truth —
// the live dashboard (mid-game standing) and the epilogue (final verdict) both read them, and
// so will any UI. Keeping them here stops the scoreboard and the ending from ever disagreeing.

export type TargetResult = {
  name: string
  goal: string
  actual: string
  hit: boolean
}

// Assess the targets against a planet state and the peak temperature seen so far. Used live
// each round (current standing) and at the end (final verdict) with the same thresholds.
export function assessTargets(planet: PlanetState, peakTemp: number): TargetResult[] {
  const p = planet
  const falling = p.tempAnomaly < peakTemp - 0.01
  return [
    { name: 'Annual emissions', goal: '≤ 18 GtCO₂e', actual: `${p.annualEmissions.toFixed(1)} Gt`, hit: p.annualEmissions <= 18 },
    { name: 'Peak temperature', goal: '< 1.6°C & falling', actual: `${peakTemp.toFixed(2)}°C ${falling ? 'falling' : 'rising'}`, hit: peakTemp < 1.6 && falling },
    { name: 'Tropical forest loss', goal: 'net zero', actual: `${p.forestLossRate.toFixed(1)} Mha/yr`, hit: p.forestLossRate <= 0.5 },
    { name: 'Wetland restoration', goal: '+30%', actual: `+${p.wetlandRestored.toFixed(0)}%`, hit: p.wetlandRestored >= 30 },
    { name: 'Biodiversity index', goal: 'stabilised', actual: `${p.biodiversityIndex.toFixed(0)}`, hit: p.biodiversityIndex >= 28 },
    { name: 'Coral extent', goal: '< 30% loss', actual: `${p.coralExtent.toFixed(0)}% of 1990`, hit: p.coralExtent >= 35 },
    { name: 'Climate displacement', goal: '< 40M/yr', actual: `${p.displacedAnnual.toFixed(0)}M/yr`, hit: p.displacedAnnual < 40 },
    { name: 'Food insecurity', goal: '≤ 600M', actual: `${p.foodInsecure.toFixed(0)}M`, hit: p.foodInsecure <= 600 },
    { name: 'Climate damages', goal: '≤ 3% GDP', actual: `${p.damagesPctGdp.toFixed(1)}%`, hit: p.damagesPctGdp <= 3 },
  ]
}

export function targetsHit(planet: PlanetState, peakTemp: number): number {
  return assessTargets(planet, peakTemp).filter((t) => t.hit).length
}
