// Interactive text version. You take one ministerial seat; five AI ministers fill the rest.
// Twelve rounds, no win state — a world state report and a ledger of what you traded.
//
//   npm run play              (Treasury by default)
//   npm run play -- --seed 7  (fix the world's luck)
//
// This is a terminal front end over the pure engine. It runs its own round loop rather than
// game.ts because a human is in the commitment phase.

import * as readline from 'node:readline'
import { stdin as input, stdout as output } from 'node:process'

import { loadOpeningState } from '../engine/opening-state.ts'
import { stepClimate, initAccumulators, type ClimateAccumulators } from '../engine/climate.ts'
import { initStocks, stepStocks } from '../engine/stocks.ts'
import { initDeathModel, resolveDeaths, type DeathContext, type AvailableOption } from '../engine/death.ts'
import { getTier, getPolicy, policiesByDomain } from '../engine/policies.ts'
import { policyCopy } from '../engine/policy-copy.ts'
import { initPipeline, enact, landDue, type Pipeline } from '../engine/pipeline.ts'
import {
  initCabinet, resolveRound, budgetFor, pointCostFor, isLegalFor, cabinetInstability, ministerOf,
  type Committed, type ExternalPolitical,
} from '../engine/political.ts'
import { rollEvents, applyEvents, combineShocks } from '../engine/events-deck.ts'
import { drawWorldCard } from '../engine/world-deck.ts'
import { assignForecasts, projectForecast, vindicatedSeat } from '../engine/forecast.ts'
import { makeRng } from '../engine/rng.ts'
import { assessTargets } from '../engine/targets.ts'
import type { DeathLedgerEntry } from '../engine/types.ts'
import { decide } from '../engine/ai.ts'
import { epilogue } from './epilogue.ts'
import type { Cabinet, PlanetState, PolicyTier, PortfolioId, Severity } from '../engine/types.ts'
import type { GameRecord, RoundRecord } from './game.ts'
import { SETTLE_ROUNDS } from './game.ts'

const PORTFOLIOS: PortfolioId[] = ['energy', 'agriculture', 'treasury', 'foreign', 'environment', 'resilience']
const SEAT_NAME: Record<PortfolioId, string> = {
  energy: 'Energy', agriculture: 'Agriculture & Land', treasury: 'Treasury',
  foreign: 'Foreign & Trade', environment: 'Environment', resilience: 'Civil Resilience',
}
const SEAT_WEAKNESS: Record<PortfolioId, string> = {
  energy: 'blamed first for price shocks and blackouts',
  agriculture: 'rural base, fastest to riot',
  treasury: 'owns every downturn, blamed for every cost',
  foreign: 'no domestic base to protect you',
  environment: 'cheap wins, perpetually accused of irrelevance',
  resilience: 'only visible after something has already gone wrong',
}

const SEV: Severity[] = ['light', 'moderate', 'aggressive']

// A line reader that buffers every incoming line, so piped input is never dropped between
// prompts (the classic readline-pipe race) and interactive typing still blocks as expected.
const rl = readline.createInterface({ input, output, terminal: false })
const lineQueue: string[] = []
let pendingResolve: ((l: string) => void) | null = null
let streamClosed = false
rl.on('line', (l) => {
  if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r(l) }
  else lineQueue.push(l)
})
rl.on('close', () => { streamClosed = true; if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r('') } })
function ask(prompt: string): Promise<string> {
  output.write(prompt)
  if (lineQueue.length) return Promise.resolve(lineQueue.shift()!)
  if (streamClosed) return Promise.resolve('')
  return new Promise((res) => { pendingResolve = res })
}

const say = (s = '') => console.log(s)
const rule = (c = '─') => c.repeat(66)

function arg(flag: string, def: string): string {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? (process.argv[i + 1] ?? def) : def
}

// Compact one-line summary of a tier's planetary effect, for the menu.
function effectSummary(tier: PolicyTier): string {
  const e = tier.effects
  const parts: string[] = []
  const add = (k: keyof PlanetState, label: string, unit = '') => {
    const v = e[k] as number | undefined
    if (v) parts.push(`${label} ${v > 0 ? '+' : ''}${v}${unit}`)
  }
  add('coalitionEmissions', 'coalition CO₂', ' Gt')
  add('nonMemberEmissions', 'non-member CO₂', ' Gt')
  add('methane', 'CH₄', ' ppb')
  add('foodInsecure', 'food', 'M')
  add('displacedUnresettled', 'unresettled', 'M')
  add('forestLossRate', 'forest', ' Mha')
  add('wetlandRestored', 'wetland', '%')
  if (tier.adaptationValue) parts.push(`+adapt ${tier.adaptationValue}`)
  if (tier.resilienceValue) parts.push(`+resil ${tier.resilienceValue}`)
  if (tier.resettleValue) parts.push(`resettle ${tier.resettleValue}M`)
  return parts.length ? parts.join(', ') : 'no direct planetary effect'
}

function selfCostStr(tier: PolicyTier, seat: PortfolioId): string {
  const own = tier.politicalCost[seat] ?? 0
  const spill = Object.entries(tier.politicalCost)
    .filter(([p, v]) => p !== seat && (v as number) !== 0)
    .map(([p, v]) => `${SEAT_NAME[p as PortfolioId].split(' ')[0]} ${(v as number) > 0 ? '-' : '+'}${Math.abs(v as number)}`)
  const ownStr = own > 0 ? `you -${own}` : own < 0 ? `you +${-own}` : 'you 0'
  return [ownStr, ...spill].join(', ')
}

async function chooseSeat(): Promise<PortfolioId> {
  say('\nWhich seat will you take?\n')
  PORTFOLIOS.forEach((p, i) => say(`  ${i + 1}. ${SEAT_NAME[p].padEnd(22)} — ${SEAT_WEAKNESS[p]}`))
  const a = (await ask('\nSeat [1-6, Enter = Treasury]: ')).trim()
  const idx = a === '' ? 2 : Number(a) - 1
  return PORTFOLIOS[idx] && idx >= 0 && idx < 6 ? PORTFOLIOS[idx] : 'treasury'
}

function healthBar(h: number): string {
  const band = h >= 8 ? 'STRONG' : h >= 5 ? 'stable' : h >= 3 ? 'FRAGILE' : h >= 1 ? 'CRITICAL' : 'FALLEN'
  return `${h.toFixed(1)}/10 (${band}, ${budgetTier(h)} pts)`
}
function budgetTier(h: number): number {
  return h >= 8 ? 5 : h >= 5 ? 4 : h >= 3 ? 3 : h >= 1 ? 2 : 0
}
function bandLabel(h: number): string {
  return h >= 8 ? 'STRONG' : h >= 5 ? 'stable' : h >= 3 ? 'FRAGILE' : h >= 1 ? 'CRITICAL' : 'FALLEN'
}

async function main() {
  const seed = Number(arg('--seed', String(Math.floor(Math.random() * 1e6))))

  say('\n' + rule('═'))
  say('  MINISTERS — you have a twenty-year mandate and a planet already 1.3°C hot.')
  say(rule('═'))
  say('\nThere is no winning. There is only how many people die, and whether the next')
  say('generation gets a chance. Every policy that helps the planet costs you politically.')
  say('The counter only ever rises. All you can do is change the slope.')

  const seat = await chooseSeat()

  // --- engine state ---
  let planet = loadOpeningState()
  let acc = initAccumulators()
  let stocks = initStocks()
  let deathModel = initDeathModel()
  let pipeline = initPipeline()
  let cabinet = initCabinet(seat)
  const rng = makeRng(seed)
  const forecasts = assignForecasts(rng.fork(99))
  // The slope, made visible: what the counter would have reached had the whole cabinet done
  // nothing for twelve rounds. The gap is what you bent; that both lines rise is the point.
  const shadowCounter = doNothingBaseline(seed)
  let instability = cabinetInstability(cabinet)

  // record for the epilogue
  const rounds: RoundRecord[] = []
  const ledger = []
  const allSuccessions = []
  let peakTemp = planet.tempAnomaly
  let totalFeedbackCards = 0
  let totalDisasterMagnitude = 0
  const tradeLedger: string[] = []  // one line per round: what you traded
  // Tally of how you governed, for the reckoning.
  const did = { emissions: 0, methane: 0, relief: 0, resilience: 0, healthSpent: 0, roundsActed: 0, roundsHeld: 0, toppled: 0 }

  say(`\nYou are the ${SEAT_NAME[seat]} minister. Your weakness: ${SEAT_WEAKNESS[seat]}.`)
  say(`Your private forecast: "${forecasts[seat].name}". You cannot prove it to anyone.`)
  say(`World seed ${seed}. Twelve rounds. Let's begin.\n`)
  await ask('[Enter to start Round 1]')

  for (let round = 1; round <= 12; round++) {
    const you = ministerOf(cabinet, seat)

    // ---- Phase 1: the world moves ----
    const fired = rollEvents(planet, rng)
    const ev = applyEvents(fired, pipeline, round)
    pipeline = ev.pipeline
    const worldCard = drawWorldCard(instability, rng)
    const external: ExternalPolitical = { byPortfolio: worldCard.healthDelta, cabinet: worldCard.cabinetHealthDelta }

    say('\n' + rule('━'))
    say(`  ROUND ${round} of 12  ·  ${2026 + 2 * round}  ·  ${planet.tempAnomaly.toFixed(2)}°C  ·  ${12 - round} left`)
    say(rule('━'))
    const shadowNow = round >= 2 ? shadowCounter[round - 2]! : 0
    const bent = shadowNow - planet.cumulativeDeaths
    say(`  ☠  Counter: ${(planet.cumulativeDeaths / 1000).toFixed(2)} bn rising` +
      `   │   had the cabinet done nothing: ${(shadowNow / 1000).toFixed(2)} bn` +
      (bent > 0 ? `   │   you've bent it ${(bent / 1000).toFixed(2)} bn — and it still rose` : ''))
    say('')
    say(`  WORLD: ${worldCard.name} — ${describeWorld(worldCard.flavor)}`)
    if (fired.length) {
      say(`  EVENTS:`)
      for (const c of fired) say(`    • ${c.name}${c.kind === 'feedback' ? '  ⚡(feedback)' : ''} — ${c.flavor}`)
    }
    for (const pf of ev.pulledForward) say(`    ⚡ pipeline pulled forward: ${pf}`)

    // dashboard
    say('')
    say(`  PLANET   emissions ${planet.annualEmissions.toFixed(0)} Gt` +
      ` (coalition ${planet.coalitionEmissions.toFixed(0)} · non-member ${planet.nonMemberEmissions.toFixed(0)}, free-riding) · ` +
      `CH₄ ${planet.methane.toFixed(0)}`)
    say(`           food-insecure ${planet.foodInsecure.toFixed(0)}M · unresettled ${planet.displacedUnresettled.toFixed(0)}M · ` +
      `damages ${planet.damagesPctGdp.toFixed(1)}%`)
    printTargets(planet, peakTemp)
    say(`  YOU      ${SEAT_NAME[seat]} (gen ${you.generation}) · health ${healthBar(you.politicalHealth)}` +
      (you.restrictions.length ? ` · LOCKED: ${you.restrictions.map((r) => `${r.forbidsFlag} (${r.roundsRemaining}r)`).join(', ')}` : ''))
    printForecast(projectForecast(forecasts[seat], planet, acc, round))

    // pipeline: everything enacted and not yet landed, so lag is always legible.
    printPipeline(pipeline.pending, round, seat)

    // ---- Phase 3: AI declarations ----
    const aiMoves: Committed[] = []
    const declByPortfolio = new Map<PortfolioId, string>()
    for (const p of PORTFOLIOS) {
      if (p === seat) continue
      const m = ministerOf(cabinet, p)
      const d = decide(m, forecasts[p], planet, budgetFor(m))
      declByPortfolio.set(p, d.declaration)
      if (d.move) aiMoves.push(d.move)
    }
    const declarations = [...declByPortfolio.values()]

    // The cabinet: your colleagues' health (spillover from your policies lands here) and
    // what each intends this round. This is where "someone else has to take the hit" lives.
    say('\n  ── THE CABINET ──  (spillover from your policies lands on their health)')
    for (const p of PORTFOLIOS) {
      if (p === seat) continue
      const m = ministerOf(cabinet, p)
      const risk = m.politicalHealth < 3 ? '  ⚠ near falling' : ''
      const lock = m.restrictions.length ? `  [locked: ${m.restrictions.map((r) => r.forbidsFlag).join(', ')}]` : ''
      say(`    ${SEAT_NAME[p].padEnd(20)} ${m.politicalHealth.toFixed(1).padStart(4)}/10 ${bandLabel(m.politicalHealth).padEnd(8)} gen${m.generation}${risk}${lock}`)
      say(`         “${declByPortfolio.get(p)}”`)
    }

    // ---- Phase 4: your commitment ----
    const yourMoves = await humanTurn(you, seat)
    // Name the trade you just made, and record it — the core of the game, made apparent at
    // the moment you make it, and kept as a running ledger of what you traded.
    tradeLedger.push(printTrade(yourMoves, seat, cabinet, round))
    // Which colleagues your policies spill onto this round — so if one falls, the fall can be
    // traced back to your trade by name.
    const yourSpill = new Set<PortfolioId>()
    for (const mv of yourMoves) {
      const tier = getTier(mv.policyId, mv.severity)
      did.emissions += Math.max(0, -((tier.effects.coalitionEmissions ?? 0) + (tier.effects.nonMemberEmissions ?? 0)))
      did.methane += Math.max(0, -(tier.effects.methane ?? 0))
      did.relief += Math.max(0, -(tier.effects.foodInsecure ?? 0))
      did.resilience += (tier.adaptationValue ?? 0) + (tier.resilienceValue ?? 0) + (tier.resettleValue ?? 0)
      did.healthSpent += Math.max(0, tier.politicalCost[seat] ?? 0)
      for (const [p, v] of Object.entries(tier.politicalCost) as [PortfolioId, number][]) {
        if (p !== seat && v > 0) yourSpill.add(p)
      }
    }
    if (yourMoves.length === 0) did.roundsHeld++
    else did.roundsActed++
    for (const mv of yourMoves) pipeline = enact(pipeline, mv.policyId, mv.severity, round, seat, you.generation)
    for (const mv of aiMoves) {
      const m = ministerOf(cabinet, mv.by)
      pipeline = enact(pipeline, mv.policyId, mv.severity, round, mv.by, m.generation)
    }
    const committed = [...yourMoves, ...aiMoves]

    // unspent points for the preventable ledger
    const spent = yourMoves.reduce((a, mv) => a + pointCostFor(you, getPolicy(mv.policyId), getTier(mv.policyId, mv.severity)), 0)
    let cabinetPointsUnspent = Math.max(0, budgetFor(you) - spent)
    let maxLeftover = Math.max(0, budgetFor(you) - spent)
    for (const p of PORTFOLIOS) {
      if (p === seat) continue
      const m = ministerOf(cabinet, p)
      const s = aiMoves.filter((mv) => mv.by === p).reduce((a, mv) => a + pointCostFor(m, getPolicy(mv.policyId), getTier(mv.policyId, mv.severity)), 0)
      cabinetPointsUnspent += Math.max(0, budgetFor(m) - s)
      maxLeftover = Math.max(maxLeftover, budgetFor(m) - s)
    }
    const PROTECTIVE: [string, Severity][] = [
      ['flood-defence', 'moderate'], ['heat-adaptation', 'moderate'], ['resettlement', 'moderate'],
      ['famine-relief', 'moderate'], ['food-resilience', 'moderate'],
    ]
    const unspentOptions: AvailableOption[] = PROTECTIVE
      .filter(([id]) => getTier(id, 'moderate').pointCost <= maxLeftover)
      .map(([id, sev]) => ({ policyId: id, policyName: getPolicy(id).name, severity: sev, tier: getTier(id, sev) }))

    // ---- Phase 6: consequence ----
    const landing = landDue(pipeline, round)
    pipeline = landing.pipeline
    const effects: Partial<PlanetState> = { ...landing.effects }
    for (const pulse of [ev.planetPulse, worldCard.planetPulse]) {
      if (!pulse) continue
      for (const [k, v] of Object.entries(pulse) as [keyof PlanetState, number][]) effects[k] = ((effects[k] as number) ?? 0) + v
    }
    const stepped = stepClimate(planet, acc, effects)
    planet = stepped.planet; acc = stepped.acc
    stocks = stepStocks(stocks, landing.landed)
    peakTemp = Math.max(peakTemp, planet.tempAnomaly)

    const wasGen = you.generation
    const pol = resolveRound(cabinet, round, committed, landing.landed, ev.domainShocks, external)
    cabinet = pol.cabinet
    allSuccessions.push(...pol.successions)
    instability = cabinetInstability(cabinet)

    const shock = combineShocks(ev.disasterShocks)
    const ctx: DeathContext = { round, planet, stocks, shock, politicalInstability: instability, cabinetPointsUnspent, unspentOptions }
    const resolved = resolveDeaths(ctx, deathModel)
    deathModel = resolved.model
    ledger.push(resolved.entry)
    planet = { ...planet, cumulativeDeaths: resolved.entry.cumulative }

    totalFeedbackCards += fired.filter((c) => c.kind === 'feedback').length
    totalDisasterMagnitude += ev.disasterShocks.reduce((a, s) => a + s.magnitude * s.exposure, 0)
    rounds.push({
      round, temp: planet.tempAnomaly, instability, deathsThisRound: resolved.entry.total,
      cumulative: resolved.entry.cumulative, worldCard: worldCard.name,
      events: fired.map((c) => c.name), feedbackCount: fired.filter((c) => c.kind === 'feedback').length,
      disasterMagnitude: 0, pulledForward: ev.pulledForward, declarations, successions: pol.successions,
    })

    // ---- report the consequence to the player ----
    const e = resolved.entry
    say('\n  ── Consequence ──')
    say(`  Deaths this round: ${e.total.toFixed(0)}M  (heat ${e.byChannel.heat.toFixed(0)} · food ${e.byChannel.food.toFixed(0)} · ` +
      `displ ${e.byChannel.displacement.toFixed(0)} · disaster ${e.byChannel.disaster.toFixed(0)} · conflict ${e.byChannel.conflict.toFixed(0)})`)
    say(`  ☠  Counter now ${(e.cumulative / 1000).toFixed(2)} billion.`)
    for (const s of pol.successions) {
      if (s.portfolio === seat) {
        say('')
        say(`  ✖ YOU FELL. Cause: ${s.cause}. You are still the ${SEAT_NAME[seat]} minister — but not the same one.`)
        say(`    A ${s.archetype} takes the office (generation ${s.newGeneration})` +
          (s.forbidsFlag ? `, and cannot use ${s.forbidsFlag} for three rounds.` : ', starting weaker but with cheap adaptation.'))
        say(`    You open the files and read your predecessor's forecast: "${forecasts[seat].name}". It is yours now.`)
      } else {
        const byYou = yourSpill.has(s.portfolio)
        say(`  ↳ ${SEAT_NAME[s.portfolio]} fell (${s.cause}) → a ${s.archetype} arrives. Every deal they made is void.`)
        if (byYou) {
          // Trace the fall back to the trade that helped cause it.
          say(`     ⤷ your policy this round spilled onto them. This one is in your ledger — ${SEAT_NAME[s.portfolio].split(' ')[0]} paid for your trade with their office.`)
          tradeLedger[round - 1] += `  ✖ COST ${SEAT_NAME[s.portfolio].split(' ')[0]} THEIR OFFICE`
          did.toppled++
        }
      }
    }
    void wasGen
    say('')
    if (round < 12) await ask('[Enter for the next round]')
  }

  // ---- post-mandate settling: your final decisions take four years to land ----
  await ask('\n[Enter — four years pass...]')
  say('\n  ── FOUR YEARS ON ──')
  say('  The mandate is over. No new decisions — but the levers you pulled at the end land now.')
  for (let s = 1; s <= SETTLE_ROUNDS; s++) {
    const settleRound = 12 + s
    const landing = landDue(pipeline, settleRound)
    pipeline = landing.pipeline
    const stepped = stepClimate(planet, acc, landing.effects)
    planet = stepped.planet; acc = stepped.acc
    stocks = stepStocks(stocks, landing.landed)
    peakTemp = Math.max(peakTemp, planet.tempAnomaly)
    const resolved = resolveDeaths(
      { round: settleRound, planet, stocks, shock: null, politicalInstability: instability, cabinetPointsUnspent: 0, unspentOptions: [] },
      deathModel,
    )
    deathModel = resolved.model
    ledger.push(resolved.entry)
    planet = { ...planet, cumulativeDeaths: resolved.entry.cumulative }
    const landedNames = landing.landed.length
      ? [...new Set(landing.landed.map((l) => getPolicy(l.policyId).name))].join(', ')
      : 'nothing new'
    say(`  ${planet.year}: ${resolved.entry.total.toFixed(0)}M more dead. Landed: ${landedNames}. ` +
      `Temp ${planet.tempAnomaly.toFixed(2)}°C, emissions ${planet.annualEmissions.toFixed(0)} Gt.`)
  }

  // ---- epilogue ----
  const chanTotals: Record<string, number> = { heat: 0, food: 0, displacement: 0, disaster: 0, conflict: 0 }
  for (const e of ledger) for (const c of Object.keys(chanTotals)) chanTotals[c] += (e as DeathLedgerEntry).byChannel[c as keyof typeof e.byChannel]
  const dominantChannel = Object.keys(chanTotals).reduce((a, b) => (chanTotals[b]! > chanTotals[a]! ? b : a)) as import('../engine/types.ts').DeathChannel
  const vind = vindicatedSeat(forecasts, dominantChannel)
  const record: GameRecord = {
    config: { seed, playerSeat: seat }, rounds, ledger,
    finalPlanet: planet, peakTemp, totalDeaths: planet.cumulativeDeaths,
    successions: allSuccessions, falls: allSuccessions.length,
    forecasts,
    vindicatedSeat: vind.seat, vindicatedEmphasis: vind.emphasis,
    vindicatedSeatFinalGeneration: ministerOf(cabinet, vind.seat).generation,
    dominantChannel,
    totalFeedbackCards, totalDisasterMagnitude,
  }
  say('\n')
  say(epilogue(record))
  if (vind.seat === seat) say(`\n  (The lens that mattered — ${vind.emphasis} — was the one in your own files.)`)

  // The reckoning: what you did, and what your choices set in motion beyond the mandate.
  printReckoning(seat, planet, acc, peakTemp, did, ledger as DeathLedgerEntry[], pipeline, dominantChannel)

  // The slope: what you bent, and the fact that it rose anyway.
  const shadowFinal = shadowCounter[11]!
  const bentFinal = shadowFinal - planet.cumulativeDeaths
  say('')
  say(`  THE SLOPE: had the cabinet done nothing, the counter reaches ${(shadowFinal / 1000).toFixed(2)} bn.`)
  say(`  You bent it to ${(planet.cumulativeDeaths / 1000).toFixed(2)} bn — ${(bentFinal / 1000).toFixed(2)} bn fewer dead than doing nothing.`)
  say(`  You could not stop it. Nobody could. All you could do was change the slope, and you did.`)

  // The ledger of what you traded — the design's ending, read back round by round.
  say('\n  ── THE LEDGER OF WHAT YOU TRADED ──')
  for (const line of tradeLedger) say(`    ${line}`)
  say('')
  rl.close()
}

// Present the menu, let the player enact policies until they finish or run out of points.
async function humanTurn(you: ReturnType<typeof ministerOf>, seat: PortfolioId): Promise<Committed[]> {
  let remaining = budgetFor(you)
  const chosen: Committed[] = []
  say(`\n  ── Your turn (${SEAT_NAME[seat]}) · budget ${remaining} points ──`)

  while (true) {
    // A policy can be enacted at one tier per round — once you commit a tier, that policy's
    // other tiers drop out (you don't stack a light and a moderate of the same lever).
    const alreadyEnacted = new Set(chosen.map((c) => c.policyId))
    // build the legal, affordable menu given remaining points
    const menu: { policyId: string; policyName: string; severity: Severity; cost: number; tierLabel: string }[] = []
    for (const policy of policiesByDomain(seat)) {
      if (!isLegalFor(you, policy)) continue
      if (alreadyEnacted.has(policy.id)) continue
      for (let i = 0; i < 3; i++) {
        const tier = policy.tiers[i]!
        const cost = pointCostFor(you, policy, tier)
        if (cost > remaining) continue
        menu.push({
          policyId: policy.id, policyName: policy.name, severity: SEV[i]!, cost,
          tierLabel: `${SEV[i]!.padEnd(10)} [${cost}p, lag ${tier.lag}]  ${effectSummary(tier)}  · cost: ${selfCostStr(tier, seat)}`,
        })
      }
    }
    if (menu.length === 0) { say('   (Nothing legal and affordable remains.)'); break }

    say(`\n   Points left: ${remaining}. Choose a policy, 0 to finish the round:`)
    // Group tiers under a per-policy header carrying the canonical description.
    let lastPolicy = ''
    menu.forEach((m, i) => {
      if (m.policyId !== lastPolicy) {
        say(`     ▸ ${m.policyName} — ${policyCopy(m.policyId).summary}`)
        lastPolicy = m.policyId
      }
      say(`        ${String(i + 1).padStart(2)}. ${m.tierLabel}`)
    })
    const a = (await ask('   > ')).trim()
    if (a === '0' || a.toLowerCase() === 'done' || a === '') break
    const idx = Number(a) - 1
    if (!Number.isInteger(idx) || idx < 0 || idx >= menu.length) { say('   (Not a valid choice.)'); continue }
    const pick = menu[idx]!
    chosen.push({ policyId: pick.policyId, severity: pick.severity, by: seat })
    remaining -= pick.cost
    say(`   ✓ committed: ${getPolicy(pick.policyId).name} (${pick.severity}). ${remaining} points left.`)
    if (remaining <= 0) break
  }
  if (chosen.length === 0) say('   You hold. (A round doing nothing recovers a little health.)')
  return chosen
}

function describeWorld(flavor: string): string { return flavor }

type DidTally = { emissions: number; methane: number; relief: number; resilience: number; healthSpent: number; roundsActed: number; roundsHeld: number; toppled: number }

// The reckoning: not a scoreboard but an accounting. How you governed, what your choices set
// in motion beyond the mandate (consequences arrive late — your policies outlive you), and
// the thesis stated plainly. Projects the planet twenty years past 2050 under the trajectory
// you leave, and reads the ratchets and the pipeline you hand to whoever comes next.
function printReckoning(
  seat: PortfolioId, planet: PlanetState, acc: ClimateAccumulators, peakTemp: number,
  did: DidTally, ledger: DeathLedgerEntry[], pipeline: Pipeline, dominantChannel: string,
) {
  const falling = planet.tempAnomaly < peakTemp - 0.01
  const last = ledger[ledger.length - 1]!

  // --- What you did ---
  const weights: [string, number][] = [
    ['a mitigation ministry — you spent yourself buying time off the atmosphere', did.emissions / 40 + did.methane / 1000],
    ['a relief ministry — you spent yourself keeping people fed', did.relief / 300],
    ['a resilience ministry — you spent yourself building the defences', did.resilience / 50],
  ]
  weights.sort((a, b) => b[1] - a[1])
  const character = did.roundsHeld > did.roundsActed ? 'a cautious ministry — you held more rounds than you spent, and let others carry the weight' : weights[0]![0]

  say('\n  ══════════════════════════════════════════════════════════════')
  say('  THE RECKONING')
  say('  ══════════════════════════════════════════════════════════════\n')
  say(`  You held ${SEAT_NAME[seat]} for twenty years — ${did.roundsActed} rounds of action, ${did.roundsHeld} spent holding to survive.`)
  say(`  History will record ${character}.`)
  say(`  You bought ${did.emissions.toFixed(0)} GtCO₂e of cuts and ${did.methane.toFixed(0)} ppb of methane off the future,`)
  say(`  delivered ${did.relief.toFixed(0)}M of food relief, and laid down ${did.resilience.toFixed(0)} points of resilience.`)
  say(`  It cost you ${did.healthSpent} points of your own standing` +
    (did.toppled > 0 ? `, and ${did.toppled} colleague${did.toppled > 1 ? 's' : ''} who paid for your trades with their careers.` : '.'))
  say(`  The channel that did the most killing, in the end, was ${dominantChannel}.`)

  // --- What comes next: project the trajectory you leave, two decades past the mandate ---
  let p = planet
  let a = acc
  const marks: Record<number, PlanetState> = {}
  for (let i = 1; i <= 10; i++) {
    const stepped = stepClimate(p, a, {})
    p = stepped.planet; a = stepped.acc
    if (p.year === 2060 || p.year === 2070) marks[p.year] = p
  }
  const y70 = marks[2070] ?? p

  say('\n  What happens now — because the mandate ends, but the pipeline does not:\n')

  const locked = [...new Set(pipeline.history.filter((e) => getTier(e.policyId, e.severity).locksIn).map((e) => getPolicy(e.policyId).name))]
  if (locked.length) {
    say(`   • Locked in for good: ${locked.join(', ')}. No future government can undo these; they keep working for people who will never know your name.`)
  }
  const legacy = [...new Set(pipeline.pending.filter((e) => e.landsRound > 12).map((e) => getPolicy(e.policyId).name))]
  if (legacy.length) {
    say(`   • Still in the pipeline, landing after 2050: ${legacy.join(', ')}. Work you began that pays off for your successors — or arrives too late for anyone.`)
  }
  say(`   • On the trajectory you leave, by 2070: ~${y70.tempAnomaly.toFixed(2)}°C ` +
    `${falling ? 'and falling — the peak is behind us, and the long descent has begun' : 'and still climbing — the warming you did not stop keeps going'}, ` +
    `~${Math.round(y70.foodInsecure)}M food-insecure, ~${Math.round(y70.displacedUnresettled)}M still displaced.`)
  if (last.byChannel.conflict > 25) {
    say(`   • The conflicts you let ignite will burn for a generation — resource wars do not end when the drought that started them is forgotten.`)
  }
  if (!falling) {
    say(`   • The feedback loops you left armed grow likelier every year the line keeps rising. The next cabinet inherits a hotter deck than you were dealt.`)
  } else {
    say(`   • The next generation inherits a stabilising world — poorer, hotter, and more crowded than the one you were handed, but no longer sliding.`)
  }

  // --- The thesis, stated plainly ---
  say('\n  ──')
  say(`  You did not play to ensure our survival. Survival was never the question — the species`)
  say(`  endures in almost every ending. You played to decide what KIND of survival, and how much`)
  say(`  of it you were willing to prevent, and didn't.`)
  say(`  Your answer: ${(planet.cumulativeDeaths / 1000).toFixed(2)} billion dead by 2050, and a world that will ` +
    `${falling ? 'hold' : 'keep sliding'} on the slope you bent but could not break.`)
}

// The do-nothing shadow: run twelve rounds where the whole cabinet never acts, on an
// independent stream off the same seed, and record the death counter at the end of each
// round. This is the slope you are bending — the ambient catastrophe, which rises no matter
// what. Pure of the real game's rng so it never disturbs it.
function doNothingBaseline(seed: number): number[] {
  let planet = loadOpeningState()
  let acc = initAccumulators()
  let stocks = initStocks()
  let deathModel = initDeathModel()
  const pipeline = initPipeline()
  const rng = makeRng((seed ^ 0x5eed) >>> 0)
  const out: number[] = []
  for (let round = 1; round <= 12; round++) {
    const fired = rollEvents(planet, rng)
    const ev = applyEvents(fired, pipeline, round)     // pipeline stays empty; no lag-shortening matters
    const worldCard = drawWorldCard(0, rng)            // a stable, idle cabinet
    const effects: Partial<PlanetState> = { ...ev.planetPulse }
    if (worldCard.planetPulse) {
      for (const [k, v] of Object.entries(worldCard.planetPulse) as [keyof PlanetState, number][]) {
        effects[k] = ((effects[k] as number) ?? 0) + v
      }
    }
    const stepped = stepClimate(planet, acc, effects)
    planet = stepped.planet; acc = stepped.acc
    stocks = stepStocks(stocks, [])                    // nothing ever lands
    const resolved = resolveDeaths(
      { round, planet, stocks, shock: combineShocks(ev.disasterShocks), politicalInstability: 0, cabinetPointsUnspent: 0, unspentOptions: [] },
      deathModel,
    )
    deathModel = resolved.model
    planet = { ...planet, cumulativeDeaths: resolved.entry.cumulative }
    out.push(planet.cumulativeDeaths)
  }
  return out
}

// The core of the game, made apparent: state the trade at the moment it is made. What you
// bought (planetary, and when it lands), what you paid now (your capital, and which colleague
// absorbs the spillover), and what you accepted getting worse to do it. Returns a one-line
// ledger entry; prints the full block.
function printTrade(moves: Committed[], seat: PortfolioId, cabinet: Cabinet, round: number) {
  if (moves.length === 0) {
    say('\n  ── THE TRADE ──')
    say('     You spent nothing and bought nothing — a round banked to recover. The counter rises anyway.')
    return `R${round}: held. Traded a round of action for health. The counter rose regardless.`
  }

  const bought: string[] = []          // planetary benefits (lagged)
  const accepted: string[] = []        // side-costs: things made worse now
  let youPay = 0
  const othersPay = new Map<PortfolioId, number>()
  let maxLag = 0

  for (const mv of moves) {
    const tier = getTier(mv.policyId, mv.severity)
    const e = tier.effects
    maxLag = Math.max(maxLag, tier.lag)
    if (e.coalitionEmissions && e.coalitionEmissions < 0) bought.push(`coalition emissions ${e.coalitionEmissions} Gt`)
    if (e.nonMemberEmissions && e.nonMemberEmissions < 0) bought.push(`non-member emissions ${e.nonMemberEmissions} Gt (via diplomacy)`)
    if (e.methane && e.methane < 0) bought.push(`methane ${e.methane} ppb`)
    if (e.forestLossRate && e.forestLossRate < 0) bought.push(`forest ${e.forestLossRate} Mha`)
    if (e.foodInsecure && e.foodInsecure < 0) bought.push(`food relief ${-e.foodInsecure}M`)
    if (tier.resettleValue) bought.push(`resettle ${tier.resettleValue}M`)
    if (tier.adaptationValue || tier.resilienceValue) bought.push(`+resilience ${(tier.adaptationValue ?? 0) + (tier.resilienceValue ?? 0)}`)
    if (e.foodInsecure && e.foodInsecure > 0) accepted.push(`food-insecure +${e.foodInsecure}M`)
    for (const [p, v] of Object.entries(tier.politicalCost) as [PortfolioId, number][]) {
      if (v <= 0) continue
      if (p === seat) youPay += v
      else othersPay.set(p, (othersPay.get(p) ?? 0) + v)
    }
  }

  const whoElse = [...othersPay.entries()].map(([p, v]) => {
    const m = cabinet.find((x) => x.portfolio === p)!
    return `${SEAT_NAME[p].split(' ')[0]} -${v} (→ ${(m.politicalHealth - v).toFixed(1)})`
  })
  const lands = maxLag >= 1 ? `${2026 + 2 * (round + maxLag)}` : 'now'
  const tooLate = round + maxLag > 12

  say('\n  ── THE TRADE ──')
  say(`     You bought:   ${bought.length ? bought.join(', ') : 'nothing for the planet'}` +
    (bought.length ? `  (lands ${lands}${tooLate ? ' — too late to count' : ''})` : ''))
  say(`     You paid now: ${youPay > 0 ? `your health -${youPay}` : 'no health'}` +
    (whoElse.length ? `, and ${whoElse.join(', ')} paid for it` : ''))
  if (accepted.length) say(`     You accepted: ${accepted.join(', ')} getting worse — the price of the lever.`)

  const ledgerBought = bought.length ? bought.join(' / ') : 'nothing'
  const ledgerCost = [youPay > 0 ? `${youPay} health` : '', ...whoElse.map((w) => w.split(' ')[0])].filter(Boolean).join(' + ')
  return `R${round}: bought ${ledgerBought}${tooLate ? ' (too late)' : ''} ⟵ paid ${ledgerCost || 'nothing'}${accepted.length ? `; accepted ${accepted.join(', ')}` : ''}`
}

// The scoreboard: all nine planetary targets, with current standing. Assessed at 2050 — hit
// most and the ending is survivable — but shown every round so the trade-offs are legible now,
// not just in the epilogue. Two columns to keep it scannable.
function printTargets(planet: PlanetState, peakTemp: number) {
  const ts = assessTargets(planet, peakTemp)
  const hit = ts.filter((t) => t.hit).length
  say(`  TARGETS  ${hit}/9 on track  (assessed 2050; hit most = survivable — the whole cabinet shares these)`)
  const cell = (t: (typeof ts)[number]) =>
    `${t.hit ? '✓' : '✗'} ${t.name.padEnd(20)} ${t.actual.padEnd(15)}`
  for (let i = 0; i < ts.length; i += 2) {
    const left = cell(ts[i]!)
    const right = ts[i + 1] ? '   ' + cell(ts[i + 1]!) : ''
    say(`     ${left}${right}`)
  }
}

// The detailed forecast: the seat's model, its worldview, its urgency call, a forward
// projection with a confidence band that narrows as the mandate runs, and the feedback
// loops it is watching. All six models are sound — this is a lens, not a gamble.
function printForecast(r: ReturnType<typeof projectForecast>) {
  say(`  FORECAST "${r.name}" · ${r.concernLabel} · confidence ${(r.confidence * 100).toFixed(0)}% (±${r.band.toFixed(2)}°C)`)
  say(`     “${r.creed}”`)
  say(`     ${r.headline}`)
  if (r.checkpoints.length) {
    say('     if the current path holds (no new policy):')
    for (const c of r.checkpoints) {
      say(`        ${c.year}:  ${c.temp.toFixed(2)}±${r.band.toFixed(2)}°C  ·  ` +
        `food-insecure ${Math.round(c.foodInsecure)}M  ·  unresettled ${Math.round(c.unresettled)}M`)
    }
  }
  if (r.feedbackWatch.length) {
    const watch = r.feedbackWatch.map((f) => `${f.name} ${(f.oddsNow * 100).toFixed(0)}%→${(f.oddsEnd * 100).toFixed(0)}%`).join(' · ')
    say(`     feedback watch: ${watch}`)
  }
}

// The pipeline made visible: what the whole cabinet has enacted that has not yet landed,
// sorted by when it lands. This is where lag stops being an abstract number — you can see
// the round each policy pays off, including anything a feedback card pulled forward or
// pushed past the mandate's end ("too late to matter").
function printPipeline(pending: { policyId: string; severity: Severity; landsRound: number; enactedBy: PortfolioId }[], round: number, seat: PortfolioId) {
  if (pending.length === 0) { say('  IN FLIGHT  nothing pending — every enacted policy has landed.'); return }
  const sorted = [...pending].sort((a, b) => a.landsRound - b.landsRound)
  say('  IN FLIGHT  (enacted, not yet landed)')
  for (const e of sorted) {
    const p = getPolicy(e.policyId)
    const inRounds = e.landsRound - round
    const eta = e.landsRound > 12 ? 'too late' : inRounds <= 0 ? 'now' : `+${inRounds}`
    const who = e.enactedBy === seat ? 'you' : SEAT_NAME[e.enactedBy].split(' ')[0]
    const tag = `lands R${e.landsRound} (${eta})`.padEnd(18)
    say(`     ${tag} ${(p.name + ' (' + e.severity + ')').padEnd(42)} ${who}`)
  }
}

main().catch((e) => { console.error(e); rl.close(); process.exit(1) })
