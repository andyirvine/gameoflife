// The simulation runner. THE deliverable.
//
//   npm run sim -- --games 1000 --seed 42
//   npm run sim -- --games 1 --verbose
//   npm run sim -- --games 1000 --player-strategy maximiser --player-seat energy
//
//   --games N            batch size (default 1000; 1 with --verbose)
//   --seed S             base seed (default 42); game i uses S+i
//   --player-strategy X  maximiser | survivor | balancer | random (default: all AI)
//   --player-seat P      which seat the strategy fills (default treasury)
//   --verbose            print one full game round-by-round, then the epilogue

import { playGame, type GameRecord } from './game.ts'
import { STRATEGY_NAMES, type StrategyName } from '../engine/strategies.ts'
import { epilogue } from './epilogue.ts'
import type { DeathChannel, PortfolioId } from '../engine/types.ts'

// ---------------- args ----------------
const argv = process.argv.slice(2)
function opt(flag: string, def: string): string {
  const i = argv.indexOf(flag)
  return i >= 0 ? (argv[i + 1] ?? def) : def
}
const verbose = argv.includes('--verbose')
const seed0 = Number(opt('--seed', '42'))
const games = Number(opt('--games', verbose ? '1' : '1000'))
const seat = opt('--player-seat', 'treasury') as PortfolioId
const strategyArg = argv.includes('--player-strategy') ? (opt('--player-strategy', '') as StrategyName) : null
if (strategyArg && !STRATEGY_NAMES.includes(strategyArg)) {
  console.error(`unknown --player-strategy "${strategyArg}". options: ${STRATEGY_NAMES.join(', ')}`)
  process.exit(1)
}

const CHANNELS: DeathChannel[] = ['heat', 'food', 'displacement', 'disaster', 'conflict']
const CODE: Record<PortfolioId, string> = {
  energy: 'ENE', agriculture: 'AGR', treasury: 'TRE', foreign: 'FOR', environment: 'ENV', resilience: 'RES',
}

// ---------------- stats helpers ----------------
function quantiles(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!
  return { min: s[0]!, p10: q(0.1), p25: q(0.25), median: q(0.5), p75: q(0.75), p90: q(0.9), max: s[s.length - 1]! }
}
function mean(xs: number[]) { return xs.reduce((a, b) => a + b, 0) / xs.length }
function pearson(xs: number[], ys: number[]) {
  const mx = mean(xs), my = mean(ys)
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < xs.length; i++) { const dx = xs[i]! - mx, dy = ys[i]! - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy)
}
function histogram(xs: number[], edges: number[]): string {
  const counts = new Array(edges.length + 1).fill(0)
  for (const x of xs) {
    let b = edges.length
    for (let i = 0; i < edges.length; i++) { if (x < edges[i]!) { b = i; break } }
    counts[b]++
  }
  const maxc = Math.max(...counts, 1)
  const labels = ['<' + edges[0]]
  for (let i = 0; i < edges.length - 1; i++) labels.push(`${edges[i]}–${edges[i + 1]}`)
  labels.push('≥' + edges[edges.length - 1])
  return counts.map((c: number, i: number) =>
    `  ${labels[i]!.padStart(9)} │ ${'█'.repeat(Math.round((c / maxc) * 40))} ${((c / xs.length) * 100).toFixed(0)}%`,
  ).join('\n')
}

function runBatch(strategy: StrategyName | null, n: number): GameRecord[] {
  const out: GameRecord[] = []
  for (let i = 0; i < n; i++) out.push(playGame({ seed: seed0 + i, playerSeat: seat, ...(strategy ? { strategy } : {}) }))
  return out
}

// ================= VERBOSE: one game as a story =================
function runVerbose() {
  const g = playGame({ seed: seed0, playerSeat: seat, ...(strategyArg ? { strategy: strategyArg } : {}) })
  const who = strategyArg ? `player seat ${CODE[seat]} = ${strategyArg}, five AI` : 'all six seats AI'
  console.log(`\n################  MINISTERS — one game, ${who}, seed ${seed0}  ################\n`)

  for (const r of g.rounds) {
    console.log(`── Round ${r.round}  (${2026 + 2 * r.round})  ${r.temp.toFixed(2)}°C ` + '─'.repeat(34))
    console.log(`   World: ${r.worldCard}${r.events.length ? `   Events: ${r.events.join(', ')}` : ''}`)
    for (const pf of r.pulledForward) console.log(`   ⚡ ${pf}`)
    // Show the AI negotiation texture: refusals and the sharpest lines.
    const notable = r.declarations.filter((d) => /I am at|to recover|aggressive|sitting this one out/.test(d)).slice(0, 4)
    for (const d of notable) console.log(`   “${d}”`)
    if (r.successions.length) {
      for (const s of r.successions) console.log(`   ↳ ${CODE[s.portfolio]} fell (${s.cause}) → ${s.archetype}, generation ${s.newGeneration}`)
    }
    console.log(`   Deaths this round: ${r.deathsThisRound.toFixed(0)}M   ·   Counter: ${(r.cumulative / 1000).toFixed(2)}bn`)
    console.log()
  }

  console.log(epilogue(g))
  console.log()
}

// ================= BATCH: the six reports =================
function runReport() {
  const primaryName = strategyArg ?? null
  const primary = runBatch(primaryName, games)
  const label = primaryName ? `${primaryName} @ ${CODE[seat]}` : 'all-AI'

  console.log(`\n################  MINISTERS — batch report  ################`)
  console.log(`Games: ${games}   Base seed: ${seed0}   Primary config: ${label}\n`)

  // 1. Outcome distribution
  const deaths = primary.map((g) => g.totalDeaths / 1000)
  const peaks = primary.map((g) => g.peakTemp)
  const emis = primary.map((g) => g.finalPlanet.annualEmissions)
  const dq = quantiles(deaths), pq = quantiles(peaks), eq = quantiles(emis)
  console.log('── 1. OUTCOME DISTRIBUTION ' + '─'.repeat(40))
  console.log('                 min    p10    p25    med    p75    p90    max')
  const fmt = (q: ReturnType<typeof quantiles>, d = 2) =>
    [q.min, q.p10, q.p25, q.median, q.p75, q.p90, q.max].map((x) => x.toFixed(d).padStart(6)).join(' ')
  console.log(`  deaths (bn)  ${fmt(dq)}`)
  console.log(`  peak temp °C ${fmt(pq)}`)
  console.log(`  emissions    ${fmt(eq, 1)}`)
  console.log(`\n  Spread best→worst: ${dq.min.toFixed(2)}bn → ${dq.max.toFixed(2)}bn  (${(dq.max / dq.min).toFixed(1)}× ).  None of them good.`)
  console.log('\n  Death-toll shape (bn):')
  console.log(histogram(deaths, [0.4, 0.6, 0.8, 1.0, 1.5, 2.0, 3.0]))

  // 2. Strategy comparison
  console.log('\n── 2. STRATEGY COMPARISON ' + '─'.repeat(41))
  console.log('  (same seeds; only the player seat differs)  seat: ' + CODE[seat])
  console.log('  strategy       min    p25    med    p75    max │ meanFalls')
  const stratRows: { name: string; deaths: number[]; falls: number }[] = []
  const baseline = runBatch(null, games)
  stratRows.push({ name: 'all-AI', deaths: baseline.map((g) => g.totalDeaths / 1000), falls: mean(baseline.map((g) => g.falls)) })
  const perStrategy: Record<string, GameRecord[]> = {}
  for (const s of STRATEGY_NAMES) {
    const b = runBatch(s, games)
    perStrategy[s] = b
    stratRows.push({ name: s, deaths: b.map((g) => g.totalDeaths / 1000), falls: mean(b.map((g) => g.falls)) })
  }
  for (const row of stratRows) {
    const q = quantiles(row.deaths)
    console.log(
      `  ${row.name.padEnd(12)} ${[q.min, q.p25, q.median, q.p75, q.max].map((x) => x.toFixed(2).padStart(6)).join(' ')} │ ${row.falls.toFixed(1).padStart(8)}`,
    )
  }
  const medMax = quantiles(perStrategy['maximiser']!.map((g) => g.totalDeaths / 1000)).median
  const medRnd = quantiles(perStrategy['random']!.map((g) => g.totalDeaths / 1000)).median
  console.log(
    `\n  Verdict: maximiser median ${medMax.toFixed(2)} vs random ${medRnd.toFixed(2)}. ` +
      (Math.abs(medMax - medRnd) < 0.05
        ? '⚠ barely separable at this seat — choices may not be mattering here.'
        : '✓ strategies separate — choices move outcomes.'),
  )

  // 3. Channel breakdown (primary, and how it shifts across strategies)
  console.log('\n── 3. CHANNEL BREAKDOWN ' + '─'.repeat(43))
  const channelShare = (recs: GameRecord[]) => {
    const tot: Record<DeathChannel, number> = { heat: 0, food: 0, displacement: 0, disaster: 0, conflict: 0 }
    let all = 0
    for (const g of recs) for (const e of g.ledger) for (const c of CHANNELS) { tot[c] += e.byChannel[c]; all += e.byChannel[c] }
    return CHANNELS.map((c) => ({ c, pct: all ? (tot[c] / all) * 100 : 0 }))
  }
  console.log('  share of all deaths, by channel:')
  console.log('  strategy      ' + CHANNELS.map((c) => c.slice(0, 5).padStart(7)).join(''))
  for (const [name, recs] of [['all-AI', baseline] as const, ...STRATEGY_NAMES.map((s) => [s, perStrategy[s]!] as const)]) {
    const sh = channelShare(recs)
    console.log(`  ${name.padEnd(12)}` + sh.map((x) => `${x.pct.toFixed(0)}%`.padStart(7)).join(''))
  }

  // 4. Succession frequency
  console.log('\n── 4. SUCCESSION FREQUENCY ' + '─'.repeat(40))
  const allFalls = primary.flatMap((g) => g.successions)
  console.log(`  Mean falls/game: ${mean(primary.map((g) => g.falls)).toFixed(2)}   (${primary.filter((g) => g.falls === 0).length} games with zero falls)`)
  const byPort = new Map<PortfolioId, number>(), byCause = new Map<string, number>(), byRound = new Map<number, number>()
  for (const s of allFalls) {
    byPort.set(s.portfolio, (byPort.get(s.portfolio) ?? 0) + 1)
    byCause.set(s.cause, (byCause.get(s.cause) ?? 0) + 1)
    byRound.set(s.round, (byRound.get(s.round) ?? 0) + 1)
  }
  console.log('  by portfolio: ' + [...byPort.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${CODE[p]} ${(n / games).toFixed(2)}/game`).join('  '))
  console.log('  by cause:     ' + [...byCause.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${((n / allFalls.length) * 100).toFixed(0)}%`).join('  '))
  const meanFallRound = allFalls.length ? mean(allFalls.map((s) => s.round)) : 0
  console.log(`  mean round of a fall: ${meanFallRound.toFixed(1)}`)

  // 5. Preventable moments
  console.log('\n── 5. PREVENTABLE MOMENTS ' + '─'.repeat(41))
  const preventablePerGame = primary.map((g) => g.ledger.reduce((a, e) => a + e.preventable.length, 0))
  const avoidablePerGame = primary.map((g) => g.ledger.reduce((a, e) => a + e.preventable.reduce((x, pv) => x + pv.deathsAvoidable, 0), 0))
  console.log(`  Mean preventable rounds/game: ${mean(preventablePerGame).toFixed(2)}`)
  console.log(`  Mean avoidable deaths flagged/game: ${mean(avoidablePerGame).toFixed(0)}M`)
  console.log(`  (rounds where the cabinet had the points and a policy on the menu that would have cut a channel)`)

  // 6. Event influence
  console.log('\n── 6. EVENT INFLUENCE ' + '─'.repeat(45))
  const feedbacks = primary.map((g) => g.totalFeedbackCards)
  const disasterMag = primary.map((g) => g.totalDisasterMagnitude)
  const rFeedback = pearson(feedbacks, deaths)
  const rDisaster = pearson(disasterMag, deaths)
  console.log(`  Correlation, feedback cards drawn ↔ death toll:  r = ${rFeedback.toFixed(2)}`)
  console.log(`  Correlation, disaster magnitude   ↔ death toll:  r = ${rDisaster.toFixed(2)}`)
  const stratSpread = Math.abs(medMax - medRnd)
  console.log(`  Player-strategy median swing: ${stratSpread.toFixed(2)}bn   vs   event-driven range: ${(dq.max - dq.min).toFixed(2)}bn`)
  const passenger = stratSpread < (dq.max - dq.min) * 0.05
  console.log(`  Read: ${passenger ? '⚠ events dominate — at one seat the player is closer to passenger than driver.' : 'the player moves outcomes, but event luck sets the range. Some influence is the point.'}`)

  console.log('\n' + '─'.repeat(66))
  console.log('Run  npm run sim -- --games 1 --verbose  to read a single game end to end.\n')
}

if (verbose) runVerbose()
else runReport()
