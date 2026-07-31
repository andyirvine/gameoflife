// The policy-selection menu builder: given a seat, its minister's doctrine/restrictions and
// budget, everyone's current health (for spill previews), and what's already selected this
// round, produce the full tiered catalogue for that seat's domain. Pure and side-effect-free
// so both the solo Session and the multiplayer client can share it rather than diverging.
import { getPolicy, getTier, policiesByDomain } from './policies.ts'
import { policyCopy } from './policy-copy.ts'
import { isLegalFor, pointCostFor, type Committed } from './political.ts'
import type { Doctrine, PortfolioId, Restriction, Severity } from './types.ts'

export type MenuTier = {
  policyId: string; policyName: string; summary: string; severity: Severity
  cost: number; lag: number; effect: string; selfCost: number
  spill: { seat: PortfolioId; amount: number; resultHealth: number }[]
  impact: { mitigation: number; relief: number; resilience: number }
  topples: boolean
  selected: boolean
  disabled: boolean
}

export type MenuMinister = { doctrine: Doctrine; restrictions: Restriction[] }

export function buildMenu(
  seat: PortfolioId,
  you: MenuMinister,
  budget: number,
  healthOf: Record<PortfolioId, number>,
  selected: Committed[],
): MenuTier[] {
  const spentTotal = selected.reduce((a, s) => a + pointCostFor(you, getPolicy(s.policyId), getTier(s.policyId, s.severity)), 0)
  const sevs: Severity[] = ['light', 'moderate', 'aggressive']
  const out: MenuTier[] = []
  for (const policy of policiesByDomain(seat)) {
    const legal = isLegalFor(you, policy)
    const pickedSeverity = selected.find((s) => s.policyId === policy.id)?.severity
    for (let i = 0; i < 3; i++) {
      const tier = policy.tiers[i]!
      const severity = sevs[i]!
      const cost = pointCostFor(you, policy, tier)
      const isSelected = pickedSeverity === severity
      const affordable = isSelected || (budget - spentTotal) >= cost
      const disabled = !legal || (pickedSeverity !== undefined && !isSelected) || !affordable
      const spill = (Object.entries(tier.politicalCost) as [PortfolioId, number][])
        .filter(([p, v]) => p !== seat && v !== 0)
        .map(([p, v]) => ({ seat: p, amount: v, resultHealth: healthOf[p] - v }))
      const e = tier.effects
      const impact = {
        mitigation: Math.max(0, -((e.coalitionEmissions ?? 0) + (e.nonMemberEmissions ?? 0))) + Math.max(0, -(e.methane ?? 0)) / 200,
        relief: Math.max(0, -(e.foodInsecure ?? 0)),
        resilience: (tier.adaptationValue ?? 0) + (tier.resilienceValue ?? 0) + (tier.resettleValue ?? 0),
      }
      out.push({
        policyId: policy.id, policyName: policy.name, summary: policyCopy(policy.id).summary,
        severity, cost, lag: tier.lag, effect: effectSummary(tier),
        selfCost: tier.politicalCost[seat] ?? 0, spill, impact,
        topples: spill.some((sp) => sp.resultHealth <= 0),
        selected: isSelected, disabled,
      })
    }
  }
  return out
}

function effectSummary(tier: import('./types.ts').PolicyTier): string {
  const e = tier.effects
  const parts: string[] = []
  const add = (v: number | undefined, label: string, unit = '') => { if (v) parts.push(`${label} ${v > 0 ? '+' : ''}${v}${unit}`) }
  add(e.coalitionEmissions, 'coalition CO₂', ' Gt')
  add(e.nonMemberEmissions, 'non-member CO₂', ' Gt')
  add(e.methane, 'CH₄', ' ppb')
  add(e.foodInsecure, 'food', 'M')
  add(e.displacedUnresettled, 'unresettled', 'M')
  add(e.forestLossRate, 'forest', ' Mha')
  add(e.wetlandRestored, 'wetland', '%')
  if (tier.adaptationValue) parts.push(`+adapt ${tier.adaptationValue}`)
  if (tier.resilienceValue) parts.push(`+resil ${tier.resilienceValue}`)
  if (tier.resettleValue) parts.push(`resettle ${tier.resettleValue}M`)
  return parts.join(', ') || 'no direct planetary effect'
}
