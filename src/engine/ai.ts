import type {
  ImpactFlag, Minister, PlanetState, Policy, PolicyTier, Severity,
} from './types.ts'
import { policiesByDomain } from './policies.ts'
import { pointCostFor, isLegalFor, predictSuccessor, type Committed } from './political.ts'
import { perceivedUrgency, type ForecastModel } from './forecast.ts'

// AI minister decision logic. No LLM. Each AI minister acts on four things: its doctrine
// (what is discounted), its forecast (which it treats as true even when it is wrong), its
// political health (self-preservation rises sharply below 4), and its portfolio's exposure.
//
// The centrepiece is that a minister can REFUSE to take the hit. An AI at health 3 asked to
// enact aggressive methane declines and says why — naming the successor the cabinet would
// get instead. That refusal is the game.

// --- Scoring weights (all AI tuning in one place) ---
const W_MITIGATION = 9     // value of a tier's mitigation, scaled by perceived urgency
const W_PROTECT = 7        // value of adaptation/relief, scaled by domain exposure
const W_HEAL = 5           // value of buying back health, scaled by self-preservation need
const SELF_COST_PENALTY = 0.6  // mild preference for less self-damage among viable tiers
const ACT_THRESHOLD = 1.5  // below this best-score, the minister does nothing (idle recovery)
const HIGH_URGENCY = 0.45  // urgency above which forgoing an aggressive tier reads as a refusal

export type AiDecision = {
  move: Committed | null       // the minister's own-domain commitment, or nothing
  declaration: string          // phase-3 plain-language line
  refusedAggressive: boolean   // declined an aggressive tier it otherwise wanted
  // Set only when move is null: why the minister held, for anything that wants to narrate
  // it structurally rather than re-parsing the declaration text.
  holdReason: 'protecting-standing' | 'no-good-option' | null
}

const SEVERITIES: Severity[] = ['light', 'moderate', 'aggressive']

// Portfolio exposure, 0..1: how much this domain's own metrics are under stress right now.
function domainExposure(portfolio: string, p: PlanetState): number {
  const c = (x: number, lo: number, hi: number) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)))
  switch (portfolio) {
    case 'energy': return c(p.annualEmissions, 18, 45)
    case 'agriculture': return 0.6 * c(p.foodInsecure, 600, 1400) + 0.4 * c(p.methane, 1600, 2400)
    case 'treasury': return 0.5 * c(p.annualEmissions, 18, 45) + 0.5 * c(p.damagesPctGdp, 2, 8)
    case 'foreign': return c(p.annualEmissions, 18, 45)
    case 'environment': return 0.5 * c(30 - p.biodiversityIndex, 0, 30) + 0.5 * c(50 - p.coralExtent, 0, 50)
    case 'resilience': return 0.6 * c(p.displacedUnresettled, 32, 400) + 0.4 * c(p.foodInsecure, 600, 1400)
    default: return 0
  }
}

// How much a tier cuts emissions/methane/deforestation, in comparable units.
export function mitigationStrength(tier: PolicyTier): number {
  const e = tier.effects
  const emissions = Math.abs((e.coalitionEmissions ?? 0) + (e.nonMemberEmissions ?? 0) + (e.annualEmissions ?? 0))
  return emissions + Math.abs(e.methane ?? 0) / 250 + Math.abs(e.forestLossRate ?? 0) * 0.3
}

// How much a tier builds protective stock or relieves food/displacement stress.
function protectStrength(tier: PolicyTier): number {
  const e = tier.effects
  return (
    (tier.adaptationValue ?? 0) + (tier.resilienceValue ?? 0) + (tier.resettleValue ?? 0) +
    Math.max(0, -(e.foodInsecure ?? 0)) / 40 +
    Math.max(0, -(e.displacedUnresettled ?? 0)) / 20
  )
}

// The self-damage floor a minister will not cross. Self-preservation rises sharply below 4:
// a fragile minister refuses any hit that would drop it below the fragile band.
function survivalFloor(health: number): number {
  if (health < 4) return 3
  if (health < 8) return 1
  return 0.5
}

export function decide(
  minister: Minister,
  forecast: ForecastModel,
  planet: PlanetState,
  budget: number,
): AiDecision {
  const urgency = perceivedUrgency(forecast, planet)
  const exposure = domainExposure(minister.portfolio, planet)
  const healNeed = Math.max(0, Math.min(1, (5 - minister.politicalHealth) / 5))
  const health = minister.politicalHealth

  const domain = policiesByDomain(minister.portfolio)

  type Candidate = { policy: Policy; tier: PolicyTier; severity: Severity; selfCost: number; score: number }
  const viable: Candidate[] = []
  // The signature aggressive hit the minister wanted but cannot survive — the one worth
  // narrating a refusal over. Prefer flagged policies (so the named successor is meaningful)
  // and, among those, the heaviest self-cost.
  let wantedButUnsafeAggressive: { policy: Policy; selfCost: number } | null = null

  for (const policy of domain) {
    if (!isLegalFor(minister, policy)) continue
    for (let i = 0; i < 3; i++) {
      const tier = policy.tiers[i]!
      const severity = SEVERITIES[i]!
      const cost = pointCostFor(minister, policy, tier)
      const selfCost = tier.politicalCost[minister.portfolio] ?? 0

      // Would this tier's political hit breach the minister's survival floor? If so it's a
      // refusal candidate, not a viable one.
      const unsafe = selfCost > 0 && health - selfCost < survivalFloor(health)
      if (
        severity === 'aggressive' && unsafe && urgency >= HIGH_URGENCY &&
        mitigationStrength(tier) > 0 && policy.flags.length > 0 &&
        (!wantedButUnsafeAggressive || selfCost > wantedButUnsafeAggressive.selfCost)
      ) {
        wantedButUnsafeAggressive = { policy, selfCost }
      }
      if (cost > budget || unsafe) continue

      const benefit =
        W_MITIGATION * urgency * mitigationStrength(tier) +
        W_PROTECT * exposure * protectStrength(tier) +
        W_HEAL * healNeed * Math.max(0, -selfCost)
      const score = benefit - SELF_COST_PENALTY * Math.max(0, selfCost)
      viable.push({ policy, tier, severity, selfCost, score })
    }
  }

  viable.sort((a, b) => b.score - a.score)
  const best = viable[0]

  if (!best || best.score < ACT_THRESHOLD) {
    // Nothing worth the cost — sit the round out and recover, unless a refusal is the story.
    if (wantedButUnsafeAggressive) {
      return {
        move: null,
        declaration: refusalLine(minister, wantedButUnsafeAggressive.policy, null),
        refusedAggressive: true,
        holdReason: 'protecting-standing',
      }
    }
    return {
      move: null, declaration: idleLine(minister, healNeed), refusedAggressive: false,
      holdReason: healNeed > 0.4 ? 'protecting-standing' : 'no-good-option',
    }
  }

  const move: Committed = { policyId: best.policy.id, severity: best.severity, by: minister.portfolio }

  // If the minister wanted an aggressive tier but could not survive it, the fallback move it
  // did take is the refusal, and it should say so — naming what it did instead.
  if (wantedButUnsafeAggressive) {
    return {
      move,
      declaration: refusalLine(minister, wantedButUnsafeAggressive.policy, { policy: best.policy, severity: best.severity }),
      refusedAggressive: true, holdReason: null,
    }
  }

  return { move, declaration: commitLine(minister, best.policy, best.severity, best.selfCost), refusedAggressive: false, holdReason: null }
}

// --- Templated phase-3 declarations ---

const NAME: Record<string, string> = {
  energy: 'Energy', agriculture: 'Agriculture', treasury: 'Treasury',
  foreign: 'Foreign', environment: 'Environment', resilience: 'Resilience',
}

function restrictionPhrase(flag: ImpactFlag | null): string {
  switch (flag) {
    case 'raisesConsumerPrices': return 'cannot raise consumer costs'
    case 'removesLivelihoods': return 'cannot touch livelihoods'
    case 'spendsInternationally': return 'cannot spend abroad'
    default: return 'starts weaker, only cheap adaptation'
  }
}

function refusalLine(
  m: Minister,
  refused: Policy,
  fallback: { policy: Policy; severity: Severity } | null,
): string {
  const succ = predictSuccessor(refused.flags)
  const consequence = `you get a ${succ.archetype} who ${restrictionPhrase(succ.forbidsFlag)} for three rounds`
  const tail = fallback
    ? `I'll do ${fallback.policy.name.toLowerCase()} ${fallback.severity} instead. Someone else finds the points for the rest.`
    : 'Someone else finds the points, or it waits.'
  return `${NAME[m.portfolio]}: I am at ${m.politicalHealth.toFixed(0)}. If I take ${refused.name.toLowerCase()} aggressive I fall, and ${consequence}. ${tail}`
}

function commitLine(m: Minister, policy: Policy, severity: Severity, selfCost: number): string {
  if (selfCost < 0) {
    return `${NAME[m.portfolio]}: taking ${policy.name.toLowerCase()} (${severity}) to recover ground. It buys nothing for the planet and I know it.`
  }
  if (severity === 'aggressive') {
    return `${NAME[m.portfolio]}: ${policy.name.toLowerCase()} aggressive. We need the cut and I can absorb the hit — for now.`
  }
  return `${NAME[m.portfolio]}: ${policy.name.toLowerCase()} at ${severity}. Holding the deeper tier in reserve.`
}

function idleLine(m: Minister, healNeed: number): string {
  if (healNeed > 0.4) return `${NAME[m.portfolio]}: sitting this one out. I need the round to recover before I am useful.`
  return `${NAME[m.portfolio]}: nothing here worth the cost this round. Holding.`
}
