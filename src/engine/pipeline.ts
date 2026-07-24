import type { PipelineEntry, PlanetState, PortfolioId, Severity } from './types.ts'
import { getTier } from './policies.ts'

// The pipeline. The mechanic that makes this a climate game rather than a resource
// allocation puzzle: political cost is paid immediately on enactment, planetary benefit
// arrives `lag` rounds later, and by then the minister who paid may be gone.
//
// Every function here is pure — it returns a new Pipeline and mutates nothing — matching
// the rest of /src/engine. The arrays are small (a game holds tens of entries), so batches
// of thousands of games stay cheap.
//
// `landsRound` is stored as an ABSOLUTE round number. That is deliberate: it makes the
// feedback-loop mechanic (a methane release shortening every remaining lag window) a
// single decrement pass rather than a re-derivation from per-entry lags.

export type Pipeline = {
  pending: PipelineEntry[]  // enacted, not yet landed
  history: PipelineEntry[]  // landed, kept for attribution and the epilogue
}

export function initPipeline(): Pipeline {
  return { pending: [], history: [] }
}

// Enact a policy tier this round. Schedules its effect to land at enactedRound + lag.
export function enact(
  pipeline: Pipeline,
  policyId: string,
  severity: Severity,
  enactedRound: number,
  enactedBy: PortfolioId,
  enactedByGeneration: number,
): Pipeline {
  const tier = getTier(policyId, severity)
  const entry: PipelineEntry = {
    policyId,
    severity,
    enactedRound,
    landsRound: enactedRound + tier.lag,
    enactedBy,
    enactedByGeneration,
    effects: tier.effects,
    adaptationValue: tier.adaptationValue ?? 0,
    resilienceValue: tier.resilienceValue ?? 0,
    resettleValue: tier.resettleValue ?? 0,
  }
  return { pending: [...pipeline.pending, entry], history: pipeline.history }
}

// Result of landing everything due in a round.
export type LandingResult = {
  pipeline: Pipeline
  landed: PipelineEntry[]
  // All PlanetState deltas merged, with resettleValue folded into displacedUnresettled,
  // ready to hand to stepClimate. Stock values travel on the landed entries (stepStocks
  // reads them directly).
  effects: Partial<PlanetState>
}

// Consequence phase: everything scheduled to land this round lands now, including policies
// enacted by ministers who no longer hold office and were destroyed for enacting them.
export function landDue(pipeline: Pipeline, round: number): LandingResult {
  const landed: PipelineEntry[] = []
  const stillPending: PipelineEntry[] = []
  for (const e of pipeline.pending) {
    if (e.landsRound <= round) landed.push(e)
    else stillPending.push(e)
  }

  const effects = mergeEffects(landed)

  return {
    pipeline: { pending: stillPending, history: [...pipeline.history, ...landed] },
    landed,
    effects,
  }
}

// Retroactively shorten every remaining lag window. A methane release (or any feedback
// card) calls this: pending entries have their landing pulled forward by `byRounds`,
// floored at `currentRound` so nothing lands in a round already resolved. Returns the
// entries whose landing round actually moved, so the caller can narrate what geology just
// did to the cabinet's long game.
export function shortenLags(
  pipeline: Pipeline,
  byRounds: number,
  currentRound: number,
): { pipeline: Pipeline; pulledForward: PipelineEntry[] } {
  const pulledForward: PipelineEntry[] = []
  const pending = pipeline.pending.map((e) => {
    const newLands = Math.max(currentRound, e.landsRound - byRounds)
    if (newLands !== e.landsRound) {
      const moved = { ...e, landsRound: newLands }
      pulledForward.push(moved)
      return moved
    }
    return e
  })
  return { pipeline: { pending, history: pipeline.history }, pulledForward }
}

// Points/round owed for policies that decay if unmaintained (upkeep). Not spent here —
// returned so the political/budget layer (step 5) can charge it. Reads the tier's upkeep.
export function upkeepDue(pipeline: Pipeline): number {
  let total = 0
  for (const e of [...pipeline.pending, ...pipeline.history]) {
    const tier = getTier(e.policyId, e.severity)
    if (tier.upkeep && !tier.locksIn) total += tier.upkeep
  }
  return total
}

// Merge a set of landed entries' effects into one PlanetState delta, folding resettle
// (which clears the unresettled stock) into displacedUnresettled.
function mergeEffects(entries: PipelineEntry[]): Partial<PlanetState> {
  const out: Partial<PlanetState> = {}
  let resettle = 0
  for (const e of entries) {
    resettle += e.resettleValue
    for (const [k, v] of Object.entries(e.effects) as [keyof PlanetState, number][]) {
      out[k] = ((out[k] as number) ?? 0) + v
    }
  }
  if (resettle > 0) {
    out.displacedUnresettled = (out.displacedUnresettled ?? 0) - resettle
  }
  return out
}
