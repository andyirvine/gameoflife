import type { Minister, PlanetState, PolicyTier, Severity } from './types.ts'
import type { Rng } from './rng.ts'
import { policiesByDomain } from './policies.ts'
import { pointCostFor, isLegalFor, type Committed } from './political.ts'
import { mitigationStrength } from './ai.ts'

// Scripted player strategies. One seat stands in for the human; the strategy chooses from
// that seat's own portfolio menu each round, respecting legality (succession locks) and the
// point budget. Comparing them across a batch is how we find out whether choices matter — if
// `random` performs like `maximiser`, the design is broken.
//
//   maximiser : always the deepest emissions cut available, ignores political cost
//   survivor  : never drops below health 5, takes light tiers only
//   balancer  : alternates hard (mitigation) and relief rounds
//   random    : legal moves at random, as a control

export type StrategyName = 'maximiser' | 'survivor' | 'balancer' | 'random'
export const STRATEGY_NAMES: StrategyName[] = ['maximiser', 'survivor', 'balancer', 'random']

export type StrategyContext = {
  minister: Minister
  planet: PlanetState
  budget: number
  round: number
  rng: Rng
}

type Option = {
  policyId: string
  severity: Severity
  cost: number
  selfCost: number
  mit: number
  isRelief: boolean   // relief/adaptation — heals or builds protective stock
}

const SEVERITIES: Severity[] = ['light', 'moderate', 'aggressive']

// Every legal, point-affordable tier in the seat's own portfolio this round.
function options(ctx: StrategyContext): Option[] {
  const out: Option[] = []
  for (const policy of policiesByDomain(ctx.minister.portfolio)) {
    if (!isLegalFor(ctx.minister, policy)) continue
    for (let i = 0; i < 3; i++) {
      const tier = policy.tiers[i]!
      const cost = pointCostFor(ctx.minister, policy, tier)
      if (cost > ctx.budget) continue
      const selfCost = tier.politicalCost[ctx.minister.portfolio] ?? 0
      out.push({
        policyId: policy.id,
        severity: SEVERITIES[i]!,
        cost,
        selfCost,
        mit: mitigationStrength(tier),
        isRelief: policy.tags.includes('relief') || policy.tags.includes('adaptation') || selfCost < 0,
      })
    }
  }
  return out
}

function toMove(o: Option, by: Minister): Committed {
  return { policyId: o.policyId, severity: o.severity, by: by.portfolio }
}

// Pick the option with the deepest mitigation (tie broken toward the heavier tier).
function deepestMitigation(opts: Option[]): Option | null {
  const withMit = opts.filter((o) => o.mit > 0)
  if (withMit.length === 0) return null
  return withMit.reduce((best, o) =>
    o.mit > best.mit || (o.mit === best.mit && sevRank(o.severity) > sevRank(best.severity)) ? o : best,
  )
}

function sevRank(s: Severity): number {
  return s === 'light' ? 0 : s === 'moderate' ? 1 : 2
}

export function decideStrategy(name: StrategyName, ctx: StrategyContext): Committed | null {
  const opts = options(ctx)
  const health = ctx.minister.politicalHealth

  switch (name) {
    case 'maximiser': {
      // Deepest cut available, political cost be damned. Still bound by points and legality —
      // which is exactly how it burns its own seat into a restriction that locks it out.
      const pick = deepestMitigation(opts)
      return pick ? toMove(pick, ctx.minister) : null
    }

    case 'survivor': {
      // Light tiers only, and never a hit that would drop health below 5.
      const safeLight = opts.filter(
        (o) => o.severity === 'light' && health - Math.max(0, o.selfCost) >= 5,
      )
      const mit = deepestMitigation(safeLight)
      if (mit) return toMove(mit, ctx.minister)
      // No safe light mitigation — take a safe light relief/adaptation instead, or hold.
      const relief = safeLight.find((o) => o.isRelief)
      return relief ? toMove(relief, ctx.minister) : null
    }

    case 'balancer': {
      const hardRound = ctx.round % 2 === 1
      if (hardRound) {
        // Deepest cut that will not itself cause a fall this round.
        const survivable = opts.filter((o) => health - Math.max(0, o.selfCost) > 0)
        const mit = deepestMitigation(survivable)
        if (mit) return toMove(mit, ctx.minister)
      } else {
        // Relief round: recover ground / build stock. Prefer the biggest heal.
        const relief = opts.filter((o) => o.isRelief)
        if (relief.length) {
          const pick = relief.reduce((best, o) => (o.selfCost < best.selfCost ? o : best))
          return toMove(pick, ctx.minister)
        }
      }
      // Fallback: whatever mitigation is available, else nothing.
      const any = deepestMitigation(opts)
      return any ? toMove(any, ctx.minister) : null
    }

    case 'random': {
      // Uniform over legal, affordable moves plus the option of doing nothing.
      if (opts.length === 0) return null
      const idx = ctx.rng.int(opts.length + 1) // +1 slot = do nothing
      return idx === opts.length ? null : toMove(opts[idx]!, ctx.minister)
    }
  }
}
