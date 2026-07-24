// Step-8 strategy comparison.
//
// Runs each scripted player strategy over the same set of seeds (Treasury seat by default,
// five AI colleagues) and compares death outcomes. This is the load-bearing question the
// brief poses: if `random` performs like `maximiser`, the player's choices are not mattering
// and the design is broken.
//
//   node src/sim/strategy-demo.ts [--games N] [--seat treasury] [--seed S]

import { playGame } from './game.ts'
import { STRATEGY_NAMES, type StrategyName } from '../engine/strategies.ts'
import type { PortfolioId } from '../engine/types.ts'

function arg(flag: string, def: string): string {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? (process.argv[i + 1] ?? def) : def
}

const games = Number(arg('--games', '400'))
const seat = arg('--seat', 'treasury') as PortfolioId
const seed0 = Number(arg('--seed', '1'))

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!
  return { min: s[0]!, p25: q(0.25), median: q(0.5), p75: q(0.75), max: s[s.length - 1]! }
}

type Row = { name: string; deaths: number[]; falls: number[]; peak: number[] }

function runStrategy(name: StrategyName | null): Row {
  const deaths: number[] = []
  const falls: number[] = []
  const peak: number[] = []
  for (let i = 0; i < games; i++) {
    const g = playGame({ seed: seed0 + i, playerSeat: seat, ...(name ? { strategy: name } : {}) })
    deaths.push(g.totalDeaths / 1000) // billions
    falls.push(g.falls)
    peak.push(g.peakTemp)
  }
  return { name: name ?? 'all-AI (baseline)', deaths, falls, peak }
}

console.log(`\n=== STRATEGY COMPARISON — ${games} games, player seat: ${seat} ===`)
console.log('Same seeds across strategies; only the player seat differs. Deaths in billions.\n')

const rows: Row[] = [runStrategy(null), ...STRATEGY_NAMES.map((n) => runStrategy(n))]

console.log('strategy              min   p25   med   p75   max │ meanFalls  meanPeak°C')
console.log('─'.repeat(78))
for (const r of rows) {
  const d = stats(r.deaths)
  const meanFalls = (r.falls.reduce((a, b) => a + b, 0) / r.falls.length).toFixed(1)
  const meanPeak = (r.peak.reduce((a, b) => a + b, 0) / r.peak.length).toFixed(2)
  console.log(
    `${r.name.padEnd(20)} ${d.min.toFixed(2)}  ${d.p25.toFixed(2)}  ${d.median.toFixed(2)}  ` +
      `${d.p75.toFixed(2)}  ${d.max.toFixed(2)} │ ${meanFalls.padStart(8)}  ${meanPeak.padStart(9)}`,
  )
}
console.log('─'.repeat(78))

// The verdict the brief asks for.
const med = (r: Row) => stats(r.deaths).median
const maximiser = rows.find((r) => r.name === 'maximiser')!
const survivor = rows.find((r) => r.name === 'survivor')!
const random = rows.find((r) => r.name === 'random')!
const balancer = rows.find((r) => r.name === 'balancer')!

console.log('\nDo choices matter?')
const spread = Math.max(med(maximiser), med(survivor), med(balancer), med(random)) -
  Math.min(med(maximiser), med(survivor), med(balancer), med(random))
console.log(`  Median spread across strategies: ${spread.toFixed(2)} bn.`)
console.log(`  maximiser median ${med(maximiser).toFixed(2)} vs random median ${med(random).toFixed(2)} ` +
  `(gap ${(med(random) - med(maximiser)).toFixed(2)} bn).`)
if (Math.abs(med(maximiser) - med(random)) < 0.1) {
  console.log('  ⚠ maximiser ≈ random — the player seat is barely moving outcomes at this seat.')
} else {
  console.log('  ✓ strategies separate — the player seat moves outcomes.')
}
console.log()
