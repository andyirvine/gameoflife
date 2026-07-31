import type {
  Cabinet,
  Doctrine,
  FallCause,
  ImpactFlag,
  Minister,
  PipelineEntry,
  Policy,
  PolicyTier,
  PortfolioId,
  Restriction,
  Severity,
  SuccessorArchetype,
} from './types.ts'
import { getPolicy, getTier } from './policies.ts'

// Political health, succession and restrictions.
//
// Health is a resource, not a status bar: it caps what a minister can spend, it is drained
// by policies that raise prices or remove livelihoods (paid immediately, before any
// planetary benefit lands), and at zero the minister is not eliminated — they are replaced
// by a successor shaped by how they fell. Every function here is pure.

// --- Constants (all political tuning in one place) ---

const START_HEALTH = 6           // originals begin stable, with room to fall
const SUCCESSOR_HEALTH = 4       // a fresh successor takes office here...
const TECHNOCRAT_HEALTH = 3      // ...except the technocrat, who starts lower
const MAX_HEALTH = 10
const RESTRICTION_ROUNDS = 3     // how long a succession menu-lock persists

const SHOCK_DAMAGE = 3           // health lost by a minister whose domain is hit by a shock
const ATTRIBUTION_BASE = 2       // credit for a landed policy, divided by its lag
const IDLE_RECOVERY = 1          // health regained by a minister who committed nothing
const TRANSITION_POINT_DIVISOR = 2 // points are halved during a transition round

// Doctrine discounts: a multiplier on a tier's point cost by policy tag. < 1 is a discount,
// > 1 a penalty. Acting outside your doctrine is always allowed and always costs full price.
const DOCTRINE_MULTIPLIERS: Record<Doctrine, Partial<Record<string, number>>> = {
  accelerationist: { mitigation: 0.7, relief: 1.3, adaptation: 1.15 },
  guardian: { adaptation: 0.7, restoration: 0.7, mitigation: 1.3 },
  dealmaker: { diplomacy: 0.65, mitigation: 1.1, relief: 1.1 },
  populist: { relief: 0.6, adaptation: 0.85, mitigation: 1.4, diplomacy: 1.3 },
}

// Default doctrine per portfolio for scripted games. The full game lets each minister pick.
const DEFAULT_DOCTRINE: Record<PortfolioId, Doctrine> = {
  energy: 'accelerationist',
  agriculture: 'guardian',
  treasury: 'dealmaker',
  foreign: 'dealmaker',
  environment: 'guardian',
  resilience: 'populist',
}

const ALL_PORTFOLIOS: PortfolioId[] = [
  'energy', 'agriculture', 'treasury', 'foreign', 'environment', 'resilience',
]

// Map a policy's impact flag to the fall cause it drives, and to the successor archetype
// and forbidden flag that failure produces (design-doc succession table).
const CAUSE_BY_FLAG: Record<ImpactFlag, FallCause> = {
  raisesConsumerPrices: 'price',
  removesLivelihoods: 'jobs',
  spendsInternationally: 'coalition',
}

const ARCHETYPE_BY_CAUSE: Record<FallCause, SuccessorArchetype> = {
  price: 'populist',
  disaster: 'technocrat',
  coalition: 'nationalist',
  jobs: 'protectionist',
}

const FORBID_BY_ARCHETYPE: Record<SuccessorArchetype, ImpactFlag | null> = {
  populist: 'raisesConsumerPrices',   // cannot raise consumer costs
  technocrat: null,                    // no lock; cheap adaptation + lower start
  nationalist: 'spendsInternationally',// cannot spend internationally
  protectionist: 'removesLivelihoods', // cannot touch employment
}

// --- Construction ---

function zeroLoss(): Record<FallCause, number> {
  return { price: 0, disaster: 0, coalition: 0, jobs: 0 }
}

export function initCabinet(playerPortfolio: PortfolioId | null): Cabinet {
  return ALL_PORTFOLIOS.map((portfolio) => ({
    portfolio,
    doctrine: DEFAULT_DOCTRINE[portfolio],
    politicalHealth: START_HEALTH,
    isPlayer: portfolio === playerPortfolio,
    generation: 1,
    restrictions: [],
    transitionRounds: 0,
    roundLossByCause: zeroLoss(),
  }))
}

export function ministerOf(cabinet: Cabinet, portfolio: PortfolioId): Minister {
  const m = cabinet.find((x) => x.portfolio === portfolio)
  if (!m) throw new Error(`no minister for ${portfolio}`)
  return m
}

// --- Budget ---

export function pointsForHealth(health: number): number {
  if (health >= 8) return 5
  if (health >= 5) return 4
  if (health >= 3) return 3
  if (health >= 1) return 2
  return 0 // fallen; succession handled before budgeting
}

// Points available to a minister this round, after any transition-round reduction.
export function budgetFor(m: Minister): number {
  const base = pointsForHealth(m.politicalHealth)
  if (m.transitionRounds > 0) return Math.max(1, Math.floor(base / TRANSITION_POINT_DIVISOR))
  return base
}

// --- Doctrine cost and legality ---

// A tier's point cost for a specific minister, after doctrine discounts. Uses the best
// (cheapest) multiplier among the policy's tags, so a policy that is both mitigation and
// adaptation gets whichever the doctrine favours.
export function pointCostFor(m: Pick<Minister, 'doctrine'>, policy: Policy, tier: PolicyTier): number {
  const mults = DOCTRINE_MULTIPLIERS[m.doctrine]
  let best = 1
  let matched = false
  for (const tag of policy.tags) {
    const mult = mults[tag]
    if (mult !== undefined) {
      best = matched ? Math.min(best, mult) : mult
      matched = true
    }
  }
  return Math.max(1, Math.round(tier.pointCost * (matched ? best : 1)))
}

// Is this policy legal for this minister right now? A succession restriction forbids any
// policy carrying the locked flag until the restriction expires.
export function isLegalFor(m: Pick<Minister, 'restrictions'>, policy: Policy): boolean {
  for (const r of m.restrictions) {
    if (r.forbidsFlag && policy.flags.includes(r.forbidsFlag)) return false
  }
  return true
}

// --- Round resolution ---

export type Committed = { policyId: string; severity: Severity; by: PortfolioId }

// A physical shock that struck a domain this round (from the Events Deck, step 6; the demo
// supplies it directly). The minister of `domain` takes disaster-cause damage.
export type DomainShock = { domain: PortfolioId; severity: number } // severity scales damage

export type SuccessionEvent = {
  round: number
  portfolio: PortfolioId
  cause: FallCause
  archetype: SuccessorArchetype
  newGeneration: number
  forbidsFlag: ImpactFlag | null
}

export type PoliticalResult = {
  cabinet: Cabinet
  successions: SuccessionEvent[]
}

// External political effects (e.g. a World Deck card) applied this round: health deltas by
// portfolio plus a cabinet-wide delta. Negatives are damage (attributed to `coalition` — a
// political shock from outside the cabinet's own choices); positives are recovery.
export type ExternalPolitical = {
  byPortfolio?: Partial<Record<PortfolioId, number>>
  cabinet?: number
}

// Resolve one round's political consequences, in order:
//   1. immediate policy costs (by portfolio, tagged by cause)
//   2. domain shock damage
//   3. attribution: credit for beneficial policies that landed this round
//   4. idle recovery for ministers who committed nothing
//   5. clamp, then process successions for anyone at zero
//   6. age restrictions and transition rounds
export function resolveRound(
  cabinet: Cabinet,
  round: number,
  committed: Committed[],
  landed: PipelineEntry[],
  shocks: DomainShock[],
  external?: ExternalPolitical,
): PoliticalResult {
  // Work on a fresh copy; reset per-round cause tracking.
  let next: Cabinet = cabinet.map((m) => ({ ...m, roundLossByCause: zeroLoss() }))
  const hit = (portfolio: PortfolioId, delta: number, cause: FallCause | null) => {
    const m = next.find((x) => x.portfolio === portfolio)
    if (!m) return
    m.politicalHealth -= delta
    if (delta > 0 && cause) m.roundLossByCause[cause] += delta
  }

  // 1. Policy costs. politicalCost is health damage by portfolio; negative values (relief,
  //    dividends) restore health. The enacting policy's flags decide the cause.
  const committedPortfolios = new Set<PortfolioId>()
  for (const c of committed) {
    committedPortfolios.add(c.by)
    const policy = getPolicy(c.policyId)
    const tier = getTier(c.policyId, c.severity)
    const cause = causeOf(policy.flags)
    for (const [portfolio, dmg] of Object.entries(tier.politicalCost) as [PortfolioId, number][]) {
      hit(portfolio, dmg, dmg > 0 ? cause : null)
    }
  }

  // 2. Domain shocks: being in office when a shock hits your domain.
  for (const s of shocks) hit(s.domain, SHOCK_DAMAGE * s.severity, 'disaster')

  // 2b. External political effects (World Deck). Damage is a hit (coalition cause);
  //     recovery is applied directly. A cabinet-wide delta touches everyone.
  if (external) {
    for (const [portfolio, delta] of Object.entries(external.byPortfolio ?? {}) as [PortfolioId, number][]) {
      if (delta < 0) hit(portfolio, -delta, 'coalition')
      else hit(portfolio, -delta, null) // negative "loss" = gain
    }
    if (external.cabinet) {
      for (const m of next) {
        m.politicalHealth += external.cabinet
        if (external.cabinet < 0) m.roundLossByCause.coalition += -external.cabinet
      }
    }
  }

  // 3. Attribution: a landed policy credits the current holder of the enacting portfolio,
  //    divided by its lag — long-game policies pay almost no political credit when they
  //    finally arrive, which is the whole "judged in round six for a round-eleven win".
  for (const e of landed) {
    const m = next.find((x) => x.portfolio === e.enactedBy)
    if (!m) continue
    const tier = getTier(e.policyId, e.severity)
    const credit = ATTRIBUTION_BASE / Math.max(1, tier.lag)
    // Full credit only if the same generation still holds the seat; a successor gets half.
    m.politicalHealth += m.generation === e.enactedByGeneration ? credit : credit / 2
  }

  // 4. Idle recovery.
  for (const m of next) {
    if (!committedPortfolios.has(m.portfolio)) m.politicalHealth += IDLE_RECOVERY
  }

  // 5. Clamp and process successions.
  const successions: SuccessionEvent[] = []
  next = next.map((m) => {
    if (m.politicalHealth > 0) {
      return { ...m, politicalHealth: Math.min(MAX_HEALTH, m.politicalHealth) }
    }
    const { minister, event } = succeed(m, round)
    successions.push(event)
    return minister
  })

  // 6. Age restrictions and transition rounds.
  next = next.map((m) => ({
    ...m,
    restrictions: m.restrictions
      .map((r) => ({ ...r, roundsRemaining: r.roundsRemaining - 1 }))
      .filter((r) => r.roundsRemaining > 0),
    transitionRounds: Math.max(0, m.transitionRounds - 1),
  }))

  return { cabinet: next, successions }
}

// Produce the successor for a fallen minister. Same portfolio, generation incremented,
// shaped by the dominant cause of the fall. Locked-in policy in the pipeline is untouched
// (we never remove pipeline entries here); informal deals are the negotiation layer's
// concern (step 7) and are void by construction because nothing here carries them forward.
function succeed(m: Minister, round: number): { minister: Minister; event: SuccessionEvent } {
  const cause = dominantCause(m.roundLossByCause)
  const archetype = ARCHETYPE_BY_CAUSE[cause]
  const forbidsFlag = FORBID_BY_ARCHETYPE[archetype]

  const restrictions: Restriction[] = []
  if (forbidsFlag) {
    restrictions.push({ archetype, forbidsFlag, roundsRemaining: RESTRICTION_ROUNDS })
  }

  const minister: Minister = {
    portfolio: m.portfolio,
    doctrine: doctrineForArchetype(archetype, m.doctrine),
    politicalHealth: archetype === 'technocrat' ? TECHNOCRAT_HEALTH : SUCCESSOR_HEALTH,
    isPlayer: m.isPlayer,
    generation: m.generation + 1,
    restrictions,
    transitionRounds: 1, // one transition round at reduced points
    roundLossByCause: zeroLoss(),
  }
  const event: SuccessionEvent = {
    round,
    portfolio: m.portfolio,
    cause,
    archetype,
    newGeneration: minister.generation,
    forbidsFlag,
  }
  return { minister, event }
}

// A price-anger fall installs a populist; a technocrat is a pragmatic guardian of
// adaptation. Nationalist/protectionist keep the predecessor's doctrine (their defining
// trait is the restriction, not a discount shift).
function doctrineForArchetype(a: SuccessorArchetype, prior: Doctrine): Doctrine {
  if (a === 'populist') return 'populist'
  if (a === 'technocrat') return 'guardian'
  return prior
}

// What successor a fall caused by these policy flags would produce. Used by the AI to name
// the consequence in its refusal line ("...and you get a populist who cannot raise prices").
export function predictSuccessor(flags: ImpactFlag[]): {
  cause: FallCause
  archetype: SuccessorArchetype
  forbidsFlag: ImpactFlag | null
} {
  const cause = causeOf(flags)
  const archetype = ARCHETYPE_BY_CAUSE[cause]
  return { cause, archetype, forbidsFlag: FORBID_BY_ARCHETYPE[archetype] }
}

function causeOf(flags: ImpactFlag[]): FallCause {
  // Price anger dominates when present, then jobs, then coalition; default coalition
  // (visible association with an unpopular win) for flagless policies that still cost.
  if (flags.includes('raisesConsumerPrices')) return CAUSE_BY_FLAG.raisesConsumerPrices
  if (flags.includes('removesLivelihoods')) return CAUSE_BY_FLAG.removesLivelihoods
  if (flags.includes('spendsInternationally')) return CAUSE_BY_FLAG.spendsInternationally
  return 'coalition'
}

function dominantCause(loss: Record<FallCause, number>): FallCause {
  let best: FallCause = 'coalition'
  let bestVal = -Infinity
  for (const cause of ['price', 'disaster', 'coalition', 'jobs'] as FallCause[]) {
    if (loss[cause] > bestVal) {
      bestVal = loss[cause]
      best = cause
    }
  }
  return best
}

// --- Instability, for the death model's conflict channel and the World Deck weighting ---

// 0 (rock solid) .. 1 (collapsing). Ministers above health 5 contribute nothing; below
// that, fragility ramps to 1 at health 0, so a couple of failing ministers move the number
// far more than everyone drifting down a point.
export function cabinetInstability(cabinet: Cabinet): number {
  let sum = 0
  for (const m of cabinet) {
    sum += Math.min(1, Math.max(0, (5 - m.politicalHealth) / 5))
  }
  return sum / cabinet.length
}
