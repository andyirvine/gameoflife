import type { PlanetState, PortfolioId } from './types.ts'
import type { Rng } from './rng.ts'
import type { Pipeline } from './pipeline.ts'
import { shortenLags } from './pipeline.ts'
import type { DisasterShock } from './death.ts'
import type { DomainShock } from './political.ts'

// The Events Deck. Physical shocks and feedback loops, probability-weighted by the state of
// the planet, never flatly random. Your choices change the odds; they never change the
// possibility. You can play well and still draw the card that ends you.
//
// Feedback cards do the horrifying thing: they modify the pipeline retroactively, shortening
// every remaining lag window so policies placed for the long game arrive into a world the
// geology has already changed.

export type EventCard = {
  id: string
  name: string
  kind: 'shock' | 'feedback'
  domain: PortfolioId | null   // whose domain takes the political hit
  // --- weighting: p triples for every `tripleEvery` °C above `refTemp`, capped ---
  refTemp: number
  base: number                 // probability at refTemp
  tripleEvery: number
  cap: number
  // Irreducible per-round baseline: weather-type shocks (cyclones, heatwaves, crop failures)
  // happen every year regardless of the anomaly — climate only loads the dice. Feedback/
  // tipping cards leave this at 0: they are genuinely temperature-gated and must be earned by
  // letting the planet heat up.
  floor?: number
  extraWeight?: (p: PlanetState) => number  // secondary multiplier on non-temperature state
  // --- outcomes ---
  disaster?: { magnitude: number; exposure: number }  // feeds the death model disaster channel
  planetPulse?: Partial<PlanetState>                   // immediate planetary deltas
  shortenLagsBy?: number                               // retroactive pipeline modification
  domainShockSeverity?: number                         // political domain-shock severity
  flavor: string
}

// The brief's exact contract: probability of drawing this card given the planet.
export function drawProbability(card: EventCard, planet: PlanetState): number {
  const scale = Math.pow(3, (planet.tempAnomaly - card.refTemp) / card.tripleEvery)
  let p = card.base * scale
  if (card.extraWeight) p *= card.extraWeight(planet)
  // Weather-type cards never drop below their irreducible baseline; temperature can only
  // raise the odds above it, never below. Feedback cards (floor 0) stay fully gated.
  p = Math.max(p, card.floor ?? 0)
  return Math.min(card.cap, Math.max(0, p))
}

const foodPressure = (p: PlanetState) => 1 + Math.max(0, (p.foodInsecure - 700) / 700)
const seaPressure = (p: PlanetState) => 1 + p.seaLevelRise / 60
const forestPressure = (p: PlanetState) => 1 + p.forestLossRate / 12

export const EVENTS_DECK: EventCard[] = [
  // ---- Feedback loops (modify the pipeline + planetary pulse) ----
  {
    id: 'siberian-methane', name: 'Siberian methane release', kind: 'feedback', domain: 'agriculture',
    refTemp: 1.4, base: 0.06, tripleEvery: 0.4, cap: 0.5,
    planetPulse: { methane: 800 }, shortenLagsBy: 1, domainShockSeverity: 0.5,
    flavor: 'Permafrost gives way. Every pending policy is now racing a faster clock.',
  },
  {
    id: 'permafrost-carbon', name: 'Permafrost carbon feedback', kind: 'feedback', domain: null,
    refTemp: 1.45, base: 0.05, tripleEvery: 0.4, cap: 0.45,
    planetPulse: { annualEmissions: 2.5, methane: 200 }, shortenLagsBy: 1,
    flavor: 'The tundra starts emitting. The budget everyone planned against just shrank.',
  },
  {
    id: 'amazon-dieback', name: 'Amazon dieback', kind: 'feedback', domain: 'environment',
    refTemp: 1.5, base: 0.04, tripleEvery: 0.4, cap: 0.4, extraWeight: forestPressure,
    planetPulse: { annualEmissions: 2.0, forestLossRate: 3, biodiversityIndex: -3 }, shortenLagsBy: 1,
    domainShockSeverity: 0.5,
    flavor: 'The rainforest tips from sink to source. Restoration placed years out is now moot.',
  },
  {
    id: 'amoc-disruption', name: 'AMOC disruption', kind: 'feedback', domain: 'agriculture',
    refTemp: 1.55, base: 0.03, tripleEvery: 0.45, cap: 0.35,
    planetPulse: { foodInsecure: 90, displacedAnnual: 8 }, shortenLagsBy: 1, domainShockSeverity: 0.6,
    flavor: 'The circulation stalls. Breadbaskets fail out of season; the whole timeline compresses.',
  },
  {
    id: 'ice-sheet-instability', name: 'West Antarctic instability', kind: 'feedback', domain: 'resilience',
    refTemp: 1.6, base: 0.03, tripleEvery: 0.4, cap: 0.35, extraWeight: seaPressure,
    planetPulse: { seaLevelRise: 12, displacedAnnual: 10, displacedUnresettled: 40 }, shortenLagsBy: 1,
    domainShockSeverity: 0.6,
    flavor: 'A marine ice cliff lets go. Coastlines and the pipeline both move at once.',
  },
  {
    id: 'tipping-cascade', name: 'Coupled tipping cascade', kind: 'feedback', domain: null,
    refTemp: 1.9, base: 0.05, tripleEvery: 0.3, cap: 0.4,
    planetPulse: { annualEmissions: 3.0, methane: 400, tempAnomaly: 0.05 }, shortenLagsBy: 2,
    flavor: 'Several tipping points fire together. Nothing in flight arrives in time now.',
  },

  // ---- Shocks (disaster channel + political domain hit) ----
  {
    id: 'wet-bulb-event', name: 'Wet-bulb heat event', kind: 'shock', domain: 'resilience',
    refTemp: 1.5, base: 0.05, tripleEvery: 0.35, cap: 0.6, floor: 0.05,
    disaster: { magnitude: 75, exposure: 1.0 }, domainShockSeverity: 1,
    flavor: 'Humid heat crosses the survivability line across a densely populated region.',
  },
  {
    id: 'monsoon-failure', name: 'Monsoon failure', kind: 'shock', domain: 'agriculture',
    refTemp: 1.45, base: 0.06, tripleEvery: 0.4, cap: 0.5, extraWeight: foodPressure, floor: 0.1,
    disaster: { magnitude: 40, exposure: 0.8 }, planetPulse: { foodInsecure: 70 }, domainShockSeverity: 1,
    flavor: 'The rains do not come. A season of harvest is written off.',
  },
  {
    id: 'regional-crop-failure', name: 'Regional crop failure', kind: 'shock', domain: 'agriculture',
    refTemp: 1.4, base: 0.08, tripleEvery: 0.45, cap: 0.55, extraWeight: foodPressure, floor: 0.12,
    disaster: { magnitude: 30, exposure: 0.7 }, planetPulse: { foodInsecure: 45 }, domainShockSeverity: 0.8,
    flavor: 'Compound heat and drought take out a staple crop across several states.',
  },
  {
    id: 'category5-cyclone', name: 'Category-5 cyclone', kind: 'shock', domain: 'resilience',
    refTemp: 1.4, base: 0.08, tripleEvery: 0.5, cap: 0.5, floor: 0.13,
    disaster: { magnitude: 45, exposure: 0.9 }, planetPulse: { displacedAnnual: 6, displacedUnresettled: 12 },
    domainShockSeverity: 1,
    flavor: 'A storm intensifies over warm water and makes landfall on a delta.',
  },
  {
    id: 'glacial-melt-stress', name: 'Glacial melt & water stress', kind: 'shock', domain: 'resilience',
    refTemp: 1.5, base: 0.05, tripleEvery: 0.4, cap: 0.4, floor: 0.08,
    disaster: { magnitude: 25, exposure: 0.7 }, planetPulse: { foodInsecure: 35, displacedAnnual: 5 },
    domainShockSeverity: 0.7,
    flavor: 'The glaciers that fed the dry-season rivers are gone; the taps run for fewer months.',
  },
  {
    id: 'heatwave-cluster', name: 'Heatwave cluster', kind: 'shock', domain: 'resilience',
    refTemp: 1.4, base: 0.09, tripleEvery: 0.45, cap: 0.55, floor: 0.13,
    disaster: { magnitude: 35, exposure: 0.85 }, domainShockSeverity: 0.8,
    flavor: 'A stalled ridge parks lethal heat over cities for weeks.',
  },
  {
    id: 'drought-belt', name: 'Expanding drought belt', kind: 'shock', domain: 'agriculture',
    refTemp: 1.45, base: 0.06, tripleEvery: 0.45, cap: 0.45, extraWeight: foodPressure, floor: 0.11,
    disaster: { magnitude: 22, exposure: 0.6 }, planetPulse: { foodInsecure: 40, forestLossRate: 1 },
    domainShockSeverity: 0.7,
    flavor: 'The arid zone widens another few hundred kilometres and does not retreat.',
  },
  {
    id: 'coral-collapse', name: 'Mass coral collapse', kind: 'shock', domain: 'environment',
    refTemp: 1.45, base: 0.07, tripleEvery: 0.4, cap: 0.5, floor: 0.09,
    disaster: { magnitude: 8, exposure: 0.5 }, planetPulse: { coralExtent: -6, biodiversityIndex: -2, foodInsecure: 15 },
    domainShockSeverity: 0.6,
    flavor: 'A back-to-back bleaching finishes what the last one started. The reef fisheries go with it.',
  },
  {
    id: 'sea-level-surge', name: 'Coastal inundation surge', kind: 'shock', domain: 'resilience',
    refTemp: 1.55, base: 0.04, tripleEvery: 0.4, cap: 0.4, extraWeight: seaPressure, floor: 0.05,
    disaster: { magnitude: 30, exposure: 0.8 }, planetPulse: { displacedAnnual: 8, displacedUnresettled: 20 },
    domainShockSeverity: 0.8,
    flavor: 'A king tide on a raised baseline puts a coastal megacity under water.',
  },
]

// Roll the whole deck: each card fires independently at its state-weighted probability, so a
// hot round can cascade. Returns the cards that fired, most-consequential first.
export function rollEvents(planet: PlanetState, rng: Rng): EventCard[] {
  const fired: EventCard[] = []
  for (const card of EVENTS_DECK) {
    if (rng.next() < drawProbability(card, planet)) fired.push(card)
  }
  // Feedback cards ordered before shocks so lag-shortening applies before this round lands.
  return fired.sort((a, b) => (a.kind === 'feedback' ? 0 : 1) - (b.kind === 'feedback' ? 0 : 1))
}

// The composed consequence of a set of fired events, ready for the runner to apply.
export type EventOutcome = {
  pipeline: Pipeline
  planetPulse: Partial<PlanetState>
  disasterShocks: DisasterShock[]
  domainShocks: DomainShock[]
  pulledForward: string[]   // pipeline entries a feedback card moved, for narration
  fired: EventCard[]
}

// Apply fired events: shorten pipeline lags for feedback cards, gather planetary pulses,
// disaster shocks (death channel) and domain shocks (political). Pure.
export function applyEvents(
  fired: EventCard[],
  pipeline: Pipeline,
  round: number,
): EventOutcome {
  let pipe = pipeline
  const planetPulse: Partial<PlanetState> = {}
  const disasterShocks: DisasterShock[] = []
  const domainShocks: DomainShock[] = []
  const pulledForward: string[] = []

  for (const card of fired) {
    if (card.shortenLagsBy) {
      const res = shortenLags(pipe, card.shortenLagsBy, round)
      pipe = res.pipeline
      for (const e of res.pulledForward) {
        pulledForward.push(`${card.name}: ${e.policyId} (${e.severity}) -> lands round ${e.landsRound}`)
      }
    }
    if (card.planetPulse) {
      for (const [k, v] of Object.entries(card.planetPulse) as [keyof PlanetState, number][]) {
        planetPulse[k] = ((planetPulse[k] as number) ?? 0) + v
      }
    }
    if (card.disaster) {
      disasterShocks.push({ label: card.name, magnitude: card.disaster.magnitude, exposure: card.disaster.exposure })
    }
    if (card.domain && card.domainShockSeverity) {
      domainShocks.push({ domain: card.domain, severity: card.domainShockSeverity })
    }
  }

  return { pipeline: pipe, planetPulse, disasterShocks, domainShocks, pulledForward, fired }
}

// The death model takes a single DisasterShock per round. Merge several fired shocks into
// one combined shock (magnitudes add; exposure is the magnitude-weighted average).
export function combineShocks(shocks: DisasterShock[]): DisasterShock | null {
  if (shocks.length === 0) return null
  if (shocks.length === 1) return shocks[0]!
  const magnitude = shocks.reduce((a, s) => a + s.magnitude, 0)
  const exposure = shocks.reduce((a, s) => a + s.magnitude * s.exposure, 0) / magnitude
  return { label: shocks.map((s) => s.label).join(' + '), magnitude, exposure }
}
