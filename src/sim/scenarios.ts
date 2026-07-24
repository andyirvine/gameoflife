import type { PortfolioId, Severity } from '../engine/types.ts'

// Scripted policy scenarios for the step-3 ledger demo. These stand in for the full
// game loop (political health, AI ministers, strategies — steps 5-8) which does not
// exist yet. Each scenario says, per round, which policies were enacted, plus a scripted
// political-instability proxy and the cabinet points left unspent that round. The last
// two are placeholders until step 5 computes them from real political health.

export type ScriptedMove = { policyId: string; severity: Severity; by: PortfolioId }

// A scripted feedback-loop trigger for the step-4 pipeline demo. Stands in for an Events
// Deck draw (step 6): it shortens every remaining lag window and delivers an immediate
// planetary pulse the same round, so the "geology beat your policy" beat is observable.
export type FeedbackTrigger = {
  label: string
  shortenBy: number      // rounds to pull every pending policy forward
  methanePulse: number   // ppb added immediately
  tempPulse: number      // °C added immediately (locked-in near-term warming)
}

export type RoundScript = {
  moves: ScriptedMove[]
  instability: number       // 0..1 proxy for mean cabinet fragility
  pointsUnspent: number      // cabinet points left on the table this round
  feedback?: FeedbackTrigger
}

export type Scenario = {
  name: string
  description: string
  rounds: RoundScript[]      // 12 rounds
}

// Helper: build 12 rounds from a per-round generator.
function build(gen: (round: number) => RoundScript): RoundScript[] {
  return Array.from({ length: 12 }, (_, i) => gen(i + 1))
}

// 1. Do nothing. The floor of ambition. Instability climbs as the world bites.
const doNothing: Scenario = {
  name: 'do-nothing',
  description: 'No policy enacted for twelve rounds. The premise with the cabinet removed.',
  rounds: build((r) => ({
    moves: [],
    instability: Math.min(0.9, 0.15 + r * 0.06),
    pointsUnspent: 12, // all six ministers, roughly, doing nothing
  })),
}

// 2. Emissions-only. Hard mitigation, neglects relief and resilience. This is the design's
// central tragedy: hold the line on emissions by accepting a food/displacement crisis you
// had the resources to prevent. Should light up preventable moments.
const emissionsOnly: Scenario = {
  name: 'emissions-only',
  description: 'Aggressive mitigation, relief and resilience neglected. Trajectory over lives.',
  rounds: build((r) => {
    const moves: ScriptedMove[] = []
    if (r <= 8) moves.push({ policyId: 'carbon-price', severity: r <= 4 ? 'moderate' : 'aggressive', by: 'treasury' })
    if (r <= 8) moves.push({ policyId: 'methane-livestock', severity: 'aggressive', by: 'agriculture' })
    if (r % 2 === 1) moves.push({ policyId: 'renewables-grid', severity: 'aggressive', by: 'energy' })
    if (r % 3 === 0) moves.push({ policyId: 'coal-phaseout', severity: 'moderate', by: 'energy' })
    return {
      moves,
      instability: Math.min(0.85, 0.2 + r * 0.05),
      pointsUnspent: 6, // relief/resilience points deliberately left unspent
    }
  }),
}

// 3. Balanced. Mitigation paired with relief, resilience and resettlement throughout.
// The best available line — still not a good ending.
const balanced: Scenario = {
  name: 'balanced',
  description: 'Mitigation paired with adaptation, relief and resettlement every round.',
  rounds: build((r) => {
    const moves: ScriptedMove[] = []
    // Mitigation, a little lighter than emissions-only.
    if (r <= 9) moves.push({ policyId: 'carbon-price', severity: 'moderate', by: 'treasury' })
    if (r <= 9) moves.push({ policyId: 'methane-livestock', severity: r <= 3 ? 'moderate' : 'aggressive', by: 'agriculture' })
    if (r % 2 === 1) moves.push({ policyId: 'renewables-grid', severity: 'aggressive', by: 'energy' })
    if (r % 3 === 0) moves.push({ policyId: 'deforestation-halt', severity: 'moderate', by: 'agriculture' })
    // Adaptation + resilience + relief, sustained.
    moves.push({ policyId: 'flood-defence', severity: r <= 6 ? 'moderate' : 'aggressive', by: 'resilience' })
    moves.push({ policyId: 'heat-adaptation', severity: r <= 6 ? 'moderate' : 'aggressive', by: 'resilience' })
    moves.push({ policyId: 'resettlement', severity: 'moderate', by: 'resilience' })
    if (r % 2 === 0) moves.push({ policyId: 'famine-relief', severity: 'moderate', by: 'resilience' })
    if (r % 2 === 0) moves.push({ policyId: 'food-resilience', severity: 'moderate', by: 'agriculture' })
    return {
      moves,
      instability: Math.max(0.1, 0.35 - r * 0.015),
      pointsUnspent: 2,
    }
  }),
}

// 4. Balanced play, but geology intervenes: a Siberian methane release in round 6 fires
// the feedback mechanic — every pending policy is pulled forward a round and a warming
// pulse lands immediately. Same policy as `balanced`; compare the two to see what the
// pipeline modification costs.
const balancedMethaneShock: Scenario = {
  name: 'balanced-methane-shock',
  description: 'Balanced play with a Siberian methane release firing the feedback loop in round 6.',
  rounds: balanced.rounds.map((r, i) =>
    i === 5 // round 6 (0-indexed)
      ? { ...r, feedback: { label: 'Siberian methane release', shortenBy: 1, methanePulse: 800, tempPulse: 0 } }
      : r,
  ),
}

export const SCENARIOS: Record<string, Scenario> = {
  'do-nothing': doNothing,
  'emissions-only': emissionsOnly,
  balanced,
  'balanced-methane-shock': balancedMethaneShock,
}
