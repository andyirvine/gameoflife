import type {
  ImpactFlag,
  PlanetState,
  Policy,
  PolicyTag,
  PolicyTier,
  PortfolioId,
  Severity,
} from './types.ts'

// The policy catalogue. 23 policies across six domains, three tiers each (69 tiers).
//
// Shape rule, applied consistently so the sim can tell us whether it holds up:
//   - point cost scales roughly 1 / 2 / 4 across light / moderate / aggressive
//   - political cost scales ~0 / 1 / (4 + spillover)
//   - planetary effect scales ~1 / 2.5 / 5
// So aggressive tiers are the best value per point and politically ruinous, and light
// tiers are near-free wins that look boring. Whether `survivor` (light-only) stays
// competitive is a finding, not a foregone conclusion.
//
// Lag discipline (design doc): relief/adaptation at 1, pricing/methane at 2-3,
// buildout/restoration at 4-6. That is what makes the methane feedback card — which
// shortens every lag by 1 — specifically gut the structural lag 4-6 policies.

type TierSpec = {
  cost: number
  lag: number
  effects: Partial<PlanetState>
  political: Partial<Record<PortfolioId, number>>
  locksIn?: boolean
  upkeep?: number
  adaptationValue?: number
  resilienceValue?: number
  resettleValue?: number
}

function tier(severity: Severity, s: TierSpec): PolicyTier {
  return {
    severity,
    pointCost: s.cost,
    lag: s.lag,
    effects: s.effects,
    politicalCost: s.political,
    locksIn: s.locksIn ?? false,
    ...(s.upkeep !== undefined ? { upkeep: s.upkeep } : {}),
    ...(s.adaptationValue !== undefined ? { adaptationValue: s.adaptationValue } : {}),
    ...(s.resilienceValue !== undefined ? { resilienceValue: s.resilienceValue } : {}),
    ...(s.resettleValue !== undefined ? { resettleValue: s.resettleValue } : {}),
  }
}

function policy(
  id: string,
  name: string,
  domain: PortfolioId,
  tags: PolicyTag[],
  flags: ImpactFlag[],
  tiers: [PolicyTier, PolicyTier, PolicyTier],
): Policy {
  return { id, name, domain, tags, flags, tiers }
}

export const POLICIES: Policy[] = [
  // ---------------------------------------------------------------- ENERGY
  policy(
    'coal-phaseout', 'Coal phase-out', 'energy',
    ['mitigation'], ['raisesConsumerPrices', 'removesLivelihoods'],
    [
      tier('light', { cost: 2, lag: 4, effects: { coalitionEmissions: -1.2 }, political: { energy: 1 } }),
      tier('moderate', { cost: 4, lag: 3, effects: { coalitionEmissions: -3.0 }, political: { energy: 3 } }),
      tier('aggressive', { cost: 7, lag: 3, effects: { coalitionEmissions: -5.5 }, political: { energy: 6, treasury: 2 }, locksIn: true }),
    ],
  ),
  policy(
    'renewables-grid', 'Renewables & grid buildout', 'energy',
    ['mitigation'], [],
    [
      tier('light', { cost: 2, lag: 6, effects: { coalitionEmissions: -1.0 }, political: { energy: 0 } }),
      tier('moderate', { cost: 5, lag: 6, effects: { coalitionEmissions: -3.5 }, political: { energy: 1 } }),
      tier('aggressive', { cost: 9, lag: 5, effects: { coalitionEmissions: -7.0 }, political: { energy: 2, treasury: 1 }, locksIn: true }),
    ],
  ),
  policy(
    'fossil-subsidy-removal', 'Fossil subsidy removal', 'energy',
    ['mitigation'], ['raisesConsumerPrices'],
    [
      tier('light', { cost: 1, lag: 3, effects: { coalitionEmissions: -0.8 }, political: { energy: 1, treasury: 1 } }),
      tier('moderate', { cost: 3, lag: 2, effects: { coalitionEmissions: -2.2 }, political: { energy: 2, treasury: 2 } }),
      tier('aggressive', { cost: 5, lag: 2, effects: { coalitionEmissions: -4.0, foodInsecure: 20 }, political: { energy: 3, treasury: 4 } }),
    ],
  ),
  policy(
    'efficiency-retrofit', 'Efficiency & building retrofit', 'energy',
    ['mitigation', 'adaptation'], [],
    [
      tier('light', { cost: 1, lag: 2, effects: { coalitionEmissions: -0.5 }, political: { energy: 0 }, adaptationValue: 2 }),
      tier('moderate', { cost: 3, lag: 2, effects: { coalitionEmissions: -1.6 }, political: { energy: 1 }, adaptationValue: 5 }),
      tier('aggressive', { cost: 5, lag: 2, effects: { coalitionEmissions: -2.8 }, political: { energy: 2 }, adaptationValue: 9 }),
    ],
  ),

  // ------------------------------------------------------------ AGRICULTURE
  policy(
    'methane-livestock', 'Methane & livestock action', 'agriculture',
    ['mitigation'], ['removesLivelihoods'],
    [
      // Light: leak detection & repair. Almost free. Design doc's near-free win.
      tier('light', { cost: 2, lag: 2, effects: { methane: -60, coalitionEmissions: -0.4 }, political: { agriculture: 0 } }),
      // Moderate: landfill capture + subsidised feed additives. Farmers grumble.
      tier('moderate', { cost: 4, lag: 2, effects: { methane: -170, coalitionEmissions: -1.0 }, political: { agriculture: 2 } }),
      // Aggressive: mandatory herd caps. Largest fast lever in the game. Cascade risk.
      tier('aggressive', { cost: 6, lag: 2, effects: { methane: -420, coalitionEmissions: -1.8, foodInsecure: 15 }, political: { agriculture: 6, resilience: 1 } }),
    ],
  ),
  policy(
    'deforestation-halt', 'Deforestation halt', 'agriculture',
    ['mitigation', 'restoration'], ['removesLivelihoods'],
    [
      tier('light', { cost: 2, lag: 3, effects: { forestLossRate: -2, coalitionEmissions: -0.5 }, political: { agriculture: 1 } }),
      tier('moderate', { cost: 4, lag: 2, effects: { forestLossRate: -5, coalitionEmissions: -1.4, biodiversityIndex: 1 }, political: { agriculture: 3 } }),
      tier('aggressive', { cost: 6, lag: 2, effects: { forestLossRate: -10, coalitionEmissions: -2.6, biodiversityIndex: 2 }, political: { agriculture: 5 }, locksIn: true }),
    ],
  ),
  policy(
    'regen-soil', 'Regenerative soil transition', 'agriculture',
    ['mitigation', 'restoration', 'adaptation'], [],
    [
      tier('light', { cost: 2, lag: 4, effects: { coalitionEmissions: -0.4, foodInsecure: -8 }, political: { agriculture: 0 }, adaptationValue: 2 }),
      tier('moderate', { cost: 3, lag: 4, effects: { coalitionEmissions: -1.1, foodInsecure: -18 }, political: { agriculture: 1 }, adaptationValue: 4 }),
      tier('aggressive', { cost: 5, lag: 4, effects: { coalitionEmissions: -2.0, foodInsecure: -32 }, political: { agriculture: 2 }, adaptationValue: 6 }),
    ],
  ),
  policy(
    'food-resilience', 'Food-system resilience', 'agriculture',
    ['adaptation', 'relief'], [],
    [
      tier('light', { cost: 1, lag: 1, effects: { foodInsecure: -20 }, political: { agriculture: -1 }, resilienceValue: 2 }),
      tier('moderate', { cost: 3, lag: 1, effects: { foodInsecure: -55 }, political: { agriculture: -2 }, resilienceValue: 5 }),
      tier('aggressive', { cost: 5, lag: 1, effects: { foodInsecure: -100 }, political: { agriculture: -3 }, resilienceValue: 8 }),
    ],
  ),

  // --------------------------------------------------------------- TREASURY
  policy(
    'carbon-price', 'Carbon price', 'treasury',
    ['mitigation'], ['raisesConsumerPrices'],
    [
      // Raises food insecurity before it pays off — the classic sacrifice.
      tier('light', { cost: 2, lag: 3, effects: { coalitionEmissions: -1.5, foodInsecure: 12 }, political: { treasury: 2 } }),
      tier('moderate', { cost: 4, lag: 2, effects: { coalitionEmissions: -3.8, foodInsecure: 30 }, political: { treasury: 4, energy: 1 } }),
      tier('aggressive', { cost: 6, lag: 2, effects: { coalitionEmissions: -6.5, foodInsecure: 55 }, political: { treasury: 6, energy: 2, agriculture: 1 }, locksIn: true }),
    ],
  ),
  policy(
    'border-carbon', 'Border carbon adjustment', 'treasury',
    ['mitigation', 'diplomacy'], ['raisesConsumerPrices', 'spendsInternationally'],
    [
      tier('light', { cost: 2, lag: 3, effects: { nonMemberEmissions: -1.2 }, political: { treasury: 1, foreign: 1 } }),
      tier('moderate', { cost: 3, lag: 3, effects: { nonMemberEmissions: -3.0 }, political: { treasury: 2, foreign: 2 } }),
      tier('aggressive', { cost: 5, lag: 2, effects: { nonMemberEmissions: -5.0 }, political: { treasury: 3, foreign: 4 } }),
    ],
  ),
  policy(
    'transition-dividend', 'Transition fund & dividend', 'treasury',
    ['relief'], [],
    [
      // Buys political health back. Trades nothing for the planet. Feels bad every time.
      tier('light', { cost: 1, lag: 1, effects: { foodInsecure: -15 }, political: { treasury: -2 } }),
      tier('moderate', { cost: 3, lag: 1, effects: { foodInsecure: -35 }, political: { treasury: -3, energy: -1 } }),
      tier('aggressive', { cost: 5, lag: 1, effects: { foodInsecure: -60 }, political: { treasury: -4, energy: -2, agriculture: -1 } }),
    ],
  ),
  policy(
    'adaptation-debt-relief', 'Adaptation debt relief', 'treasury',
    ['adaptation', 'diplomacy'], ['spendsInternationally'],
    [
      tier('light', { cost: 2, lag: 2, effects: { displacedUnresettled: -6 }, political: { treasury: 1 }, resilienceValue: 3 }),
      tier('moderate', { cost: 3, lag: 2, effects: { displacedUnresettled: -14 }, political: { treasury: 2 }, resilienceValue: 6 }),
      tier('aggressive', { cost: 5, lag: 2, effects: { displacedUnresettled: -26 }, political: { treasury: 3, foreign: 1 }, resilienceValue: 10 }),
    ],
  ),

  // ---------------------------------------------------------------- FOREIGN
  policy(
    'coalition-deal', 'Non-member coalition deal', 'foreign',
    ['diplomacy', 'mitigation'], ['spendsInternationally'],
    [
      tier('light', { cost: 2, lag: 4, effects: { nonMemberEmissions: -1.6 }, political: { foreign: 1 } }),
      tier('moderate', { cost: 4, lag: 3, effects: { nonMemberEmissions: -4.2 }, political: { foreign: 2 } }),
      tier('aggressive', { cost: 6, lag: 3, effects: { nonMemberEmissions: -7.5 }, political: { foreign: 4 }, locksIn: true }),
    ],
  ),
  policy(
    'tech-transfer', 'Clean tech transfer', 'foreign',
    ['diplomacy', 'mitigation'], ['spendsInternationally'],
    [
      tier('light', { cost: 2, lag: 5, effects: { nonMemberEmissions: -1.8 }, political: { foreign: 0 } }),
      tier('moderate', { cost: 3, lag: 4, effects: { nonMemberEmissions: -4.6 }, political: { foreign: 1 } }),
      tier('aggressive', { cost: 5, lag: 4, effects: { nonMemberEmissions: -8.0 }, political: { foreign: 2, treasury: 1 } }),
    ],
  ),
  policy(
    'trade-carbon-measures', 'High-carbon trade measures', 'foreign',
    ['diplomacy', 'mitigation'], ['spendsInternationally', 'raisesConsumerPrices'],
    [
      tier('light', { cost: 2, lag: 3, effects: { nonMemberEmissions: -1.4 }, political: { foreign: 1, treasury: 1 } }),
      tier('moderate', { cost: 3, lag: 3, effects: { nonMemberEmissions: -3.4 }, political: { foreign: 3, treasury: 1 } }),
      tier('aggressive', { cost: 5, lag: 2, effects: { nonMemberEmissions: -5.6 }, political: { foreign: 5, treasury: 2 } }),
    ],
  ),
  policy(
    'climate-finance', 'International climate finance', 'foreign',
    ['diplomacy', 'relief'], ['spendsInternationally'],
    [
      tier('light', { cost: 2, lag: 2, effects: { displacedUnresettled: -8 }, political: { foreign: 1 }, resettleValue: 4, resilienceValue: 2 }),
      tier('moderate', { cost: 3, lag: 2, effects: { displacedUnresettled: -18 }, political: { foreign: 2 }, resettleValue: 9, resilienceValue: 4 }),
      tier('aggressive', { cost: 5, lag: 1, effects: { displacedUnresettled: -32 }, political: { foreign: 3 }, resettleValue: 16, resilienceValue: 6 }),
    ],
  ),

  // ------------------------------------------------------------ ENVIRONMENT
  policy(
    'wetland-restoration', 'Wetland & mangrove restoration', 'environment',
    ['restoration', 'adaptation'], [],
    [
      tier('light', { cost: 1, lag: 4, effects: { wetlandRestored: 6, coalitionEmissions: -0.3 }, political: { environment: 0 }, adaptationValue: 2, resilienceValue: 2 }),
      tier('moderate', { cost: 3, lag: 4, effects: { wetlandRestored: 16, coalitionEmissions: -0.8, biodiversityIndex: 1 }, political: { environment: 1 }, adaptationValue: 5, resilienceValue: 4 }),
      tier('aggressive', { cost: 5, lag: 4, effects: { wetlandRestored: 32, coalitionEmissions: -1.4, biodiversityIndex: 2 }, political: { environment: 2 }, locksIn: true, adaptationValue: 8, resilienceValue: 7 }),
    ],
  ),
  policy(
    'protected-areas', 'Protected areas', 'environment',
    ['restoration'], ['removesLivelihoods'],
    [
      tier('light', { cost: 1, lag: 4, effects: { biodiversityIndex: 1, forestLossRate: -1 }, political: { environment: 1 } }),
      tier('moderate', { cost: 3, lag: 4, effects: { biodiversityIndex: 3, forestLossRate: -3 }, political: { environment: 2, agriculture: 1 } }),
      tier('aggressive', { cost: 5, lag: 4, effects: { biodiversityIndex: 6, forestLossRate: -6 }, political: { environment: 3, agriculture: 2 }, locksIn: true }),
    ],
  ),
  policy(
    'ocean-coral', 'Ocean & coral intervention', 'environment',
    ['restoration', 'adaptation'], [],
    [
      tier('light', { cost: 2, lag: 5, effects: { coralExtent: 2, oceanPh: 0.005 }, political: { environment: 0 }, resilienceValue: 1 }),
      tier('moderate', { cost: 3, lag: 5, effects: { coralExtent: 5, oceanPh: 0.012, biodiversityIndex: 1 }, political: { environment: 1 }, resilienceValue: 2 }),
      tier('aggressive', { cost: 5, lag: 5, effects: { coralExtent: 9, oceanPh: 0.02, biodiversityIndex: 2 }, political: { environment: 2 }, resilienceValue: 3 }),
    ],
  ),

  // ------------------------------------------------------------- RESILIENCE
  policy(
    'flood-defence', 'Flood defence & early warning', 'resilience',
    ['adaptation'], [],
    [
      tier('light', { cost: 1, lag: 2, effects: {}, political: { resilience: 0 }, adaptationValue: 3, resilienceValue: 2 }),
      tier('moderate', { cost: 3, lag: 2, effects: {}, political: { resilience: 1 }, adaptationValue: 7, resilienceValue: 5 }),
      tier('aggressive', { cost: 5, lag: 2, effects: {}, political: { resilience: 2 }, locksIn: true, adaptationValue: 13, resilienceValue: 9 }),
    ],
  ),
  policy(
    'heat-adaptation', 'Heat adaptation & cooling', 'resilience',
    ['adaptation'], [],
    [
      tier('light', { cost: 1, lag: 1, effects: {}, political: { resilience: 0 }, adaptationValue: 4 }),
      tier('moderate', { cost: 3, lag: 1, effects: {}, political: { resilience: 1 }, adaptationValue: 9 }),
      tier('aggressive', { cost: 5, lag: 1, effects: {}, political: { resilience: 2 }, adaptationValue: 15 }),
    ],
  ),
  policy(
    'resettlement', 'Resettlement programme', 'resilience',
    ['adaptation'], [],
    [
      tier('light', { cost: 2, lag: 1, effects: { displacedUnresettled: -10 }, political: { resilience: 1 }, resettleValue: 8, resilienceValue: 3 }),
      tier('moderate', { cost: 4, lag: 1, effects: { displacedUnresettled: -22 }, political: { resilience: 2 }, resettleValue: 18, resilienceValue: 6 }),
      tier('aggressive', { cost: 6, lag: 1, effects: { displacedUnresettled: -40 }, political: { resilience: 3, foreign: 1 }, resettleValue: 32, resilienceValue: 10 }),
    ],
  ),
  policy(
    'famine-relief', 'Famine relief & food aid', 'resilience',
    ['relief'], [],
    [
      // Fast, visible, politically useful, does nothing for the long game.
      tier('light', { cost: 1, lag: 1, effects: { foodInsecure: -25 }, political: { resilience: -1 }, resilienceValue: 2 }),
      tier('moderate', { cost: 3, lag: 1, effects: { foodInsecure: -60 }, political: { resilience: -2 }, resilienceValue: 4 }),
      tier('aggressive', { cost: 5, lag: 1, effects: { foodInsecure: -110 }, political: { resilience: -3 }, resilienceValue: 6 }),
    ],
  ),
]

// --- Lookup helpers used across the engine ---

const BY_ID = new Map(POLICIES.map((p) => [p.id, p]))

export function getPolicy(id: string): Policy {
  const p = BY_ID.get(id)
  if (!p) throw new Error(`unknown policy id: ${id}`)
  return p
}

export function getTier(id: string, severity: Severity): PolicyTier {
  const idx = severity === 'light' ? 0 : severity === 'moderate' ? 1 : 2
  return getPolicy(id).tiers[idx]
}

export function policiesByDomain(domain: PortfolioId): Policy[] {
  return POLICIES.filter((p) => p.domain === domain)
}
