// Step-5 political demo runner.
//
// Runs a scripted scenario through the political engine and reports what the brief's batch
// report will need: per-round political health for all six portfolios, when and why
// ministers fall, which successor archetype arrives, and the restriction that follows them.
// It also prints cabinet instability per round — the real value that will feed the death
// model's conflict channel and the World Deck weighting once the full runner composes them.
//
//   node src/sim/political-demo.ts [scenario]
//     scenario: emissions-only (default) | do-nothing | balanced | balanced-methane-shock
//
// Note: this demo enforces succession RESTRICTIONS (illegal moves are dropped and noted)
// but not point BUDGETS — legal, budget-respecting play is the job of the step-8 strategies.
// The scripted scenarios deliberately over-commit, which is what drives the successions
// that showcase the mechanic.

import {
  initCabinet,
  resolveRound,
  budgetFor,
  isLegalFor,
  cabinetInstability,
  ministerOf,
  type Committed,
  type DomainShock,
  type SuccessionEvent,
} from '../engine/political.ts'
import { getPolicy } from '../engine/policies.ts'
import { initPipeline, enact, landDue } from '../engine/pipeline.ts'
import type { Cabinet, PortfolioId } from '../engine/types.ts'
import { SCENARIOS, type Scenario } from './scenarios.ts'

const PORTFOLIOS: PortfolioId[] = [
  'energy', 'agriculture', 'treasury', 'foreign', 'environment', 'resilience',
]
const CODE: Record<PortfolioId, string> = {
  energy: 'ENE', agriculture: 'AGR', treasury: 'TRE',
  foreign: 'FOR', environment: 'ENV', resilience: 'RES',
}

// Which domain a scripted disaster strikes, so the domain minister takes the hit.
function shocksForRound(round: number): DomainShock[] {
  if (round === 5) return [{ domain: 'resilience', severity: 1 }]
  if (round === 9) return [{ domain: 'agriculture', severity: 1 }]
  return []
}

type RoundSnapshot = {
  round: number
  health: Record<PortfolioId, number>
  generation: Record<PortfolioId, number>
  instability: number
  fellThisRound: Set<PortfolioId>
  skipped: string[]
}

function run(scn: Scenario) {
  let cabinet: Cabinet = initCabinet(null)
  let pipeline = initPipeline()
  const snapshots: RoundSnapshot[] = []
  const allSuccessions: SuccessionEvent[] = []

  for (let round = 1; round <= 12; round++) {
    const script = scn.rounds[round - 1]!
    const skipped: string[] = []

    // Filter out moves that are illegal under an active succession restriction.
    const committed: Committed[] = []
    for (const m of script.moves) {
      const policy = getPolicy(m.policyId)
      const minister = ministerOf(cabinet, m.by)
      if (!isLegalFor(minister, policy)) {
        skipped.push(`${CODE[m.by]} blocked from ${policy.name} by ${minister.restrictions[0]?.archetype} lock`)
        continue
      }
      committed.push({ policyId: m.policyId, severity: m.severity, by: m.by })
    }

    // Enact legal moves and land what is due, for attribution credit.
    for (const c of committed) pipeline = enact(pipeline, c.policyId, c.severity, round, c.by, ministerOf(cabinet, c.by).generation)
    const landing = landDue(pipeline, round)
    pipeline = landing.pipeline

    const result = resolveRound(cabinet, round, committed, landing.landed, shocksForRound(round))
    cabinet = result.cabinet
    allSuccessions.push(...result.successions)

    const health = {} as Record<PortfolioId, number>
    const generation = {} as Record<PortfolioId, number>
    for (const p of PORTFOLIOS) {
      const m = ministerOf(cabinet, p)
      health[p] = m.politicalHealth
      generation[p] = m.generation
    }
    snapshots.push({
      round,
      health,
      generation,
      instability: cabinetInstability(cabinet),
      fellThisRound: new Set(result.successions.map((s) => s.portfolio)),
      skipped,
    })
  }

  return { snapshots, allSuccessions, cabinet }
}

// --- Printing ---

function printReport(scn: Scenario) {
  const { snapshots, allSuccessions } = run(scn)

  console.log(`\n=== POLITICAL LEDGER: ${scn.name} ===`)
  console.log(scn.description)
  console.log('\nPer-round political health (0-10). ↓ marks a fall & succession that round.')
  console.log('Budget points: 5 at 8-10, 4 at 5-7, 3 at 3-4, 2 at 1-2.\n')

  const header = 'rnd │ ' + PORTFOLIOS.map((p) => CODE[p]).join('    ') + '   │ instability'
  console.log(header)
  console.log('─'.repeat(header.length + 2))
  for (const s of snapshots) {
    const cells = PORTFOLIOS.map((p) => {
      const h = s.health[p].toFixed(1).padStart(4)
      const mark = s.fellThisRound.has(p) ? '↓' : ' '
      return `${h}${mark}`
    })
    console.log(`${String(s.round).padStart(2)}  │ ${cells.join('  ')}  │   ${s.instability.toFixed(2)}`)
  }
  console.log('─'.repeat(header.length + 2))

  // Restriction enforcement, where it fired.
  const skips = snapshots.filter((s) => s.skipped.length > 0)
  if (skips.length > 0) {
    console.log('\nRestrictions enforced (moves blocked by a succession lock):')
    for (const s of skips) for (const sk of s.skipped) console.log(`  Round ${s.round}: ${sk}`)
  }

  // Succession log — the shape of each failure.
  console.log('\nSuccessions:')
  if (allSuccessions.length === 0) {
    console.log('  None. The cabinet held for twelve rounds.')
  } else {
    for (const e of allSuccessions) {
      const lock = e.forbidsFlag ? `cannot use ${e.forbidsFlag} for 3 rounds` : 'no menu lock (cheap adaptation, starts lower)'
      console.log(
        `  Round ${e.round}: ${CODE[e.portfolio]} fell (${e.cause}) → generation ${e.newGeneration}, ` +
          `${e.archetype} — ${lock}`,
      )
    }
  }

  // Batch-report style rollups the brief asks for.
  console.log('\nSuccession frequency (what the 1000-game report will aggregate):')
  console.log(`  Total falls: ${allSuccessions.length}`)
  const byPortfolio = new Map<PortfolioId, number>()
  const byCause = new Map<string, number>()
  for (const e of allSuccessions) {
    byPortfolio.set(e.portfolio, (byPortfolio.get(e.portfolio) ?? 0) + 1)
    byCause.set(e.cause, (byCause.get(e.cause) ?? 0) + 1)
  }
  const falls = [...byPortfolio.entries()].map(([p, n]) => `${CODE[p]}×${n}`).join(', ') || '—'
  const causes = [...byCause.entries()].map(([c, n]) => `${c}×${n}`).join(', ') || '—'
  console.log(`  By portfolio: ${falls}`)
  console.log(`  By cause:     ${causes}`)
  console.log()
}

const name = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'emissions-only'
const scn = SCENARIOS[name]
if (!scn) {
  console.error(`unknown scenario "${name}". options: ${Object.keys(SCENARIOS).join(', ')}`)
  process.exit(1)
}
printReport(scn)
