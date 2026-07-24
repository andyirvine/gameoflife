// The ending. Not a win screen — a world state report and a ledger of what the cabinet
// traded. Reads a finished GameRecord and produces the text the brief's definition-of-done
// requires: the world state, the counter, the named preventable moment, and the forecast
// reveal. All derived from the same numbers the engine produced; nothing authored by hand.

import type { GameRecord } from './game.ts'
import type { DeathChannel, PortfolioId } from '../engine/types.ts'
import { assessTargets as assessTargetsLive, type TargetResult } from '../engine/targets.ts'

const SEAT_NAME: Record<PortfolioId, string> = {
  energy: 'Energy', agriculture: 'Agriculture & Land', treasury: 'Treasury',
  foreign: 'Foreign & Trade', environment: 'Environment', resilience: 'Civil Resilience',
}

// Final-round target verdict, from the shared engine assessor so the scoreboard and the
// ending never disagree.
export function assessTargets(g: GameRecord): TargetResult[] {
  return assessTargetsLive(g.finalPlanet, g.peakTemp)
}

// The single most consequential preventable moment across the game: the round where the
// cabinet had the points, and a policy on the menu that would have cut the most deaths, and
// did not spend them. This is the line the epilogue points at.
export function namedPreventable(g: GameRecord) {
  let best: { round: number; year: number; channel: DeathChannel; policy: string; points: number; unspent: number; avoided: number } | null = null
  for (const entry of g.ledger) {
    for (const pv of entry.preventable) {
      if (!best || pv.deathsAvoidable > best.avoided) {
        best = {
          round: entry.round, year: entry.year, channel: pv.channel,
          policy: pv.availablePolicy, points: pv.pointsRequired,
          unspent: pv.cabinetPointsUnspent, avoided: pv.deathsAvoidable,
        }
      }
    }
  }
  return best
}

const CRISIS_PHRASE: Record<DeathChannel, string> = {
  food: 'food crisis', displacement: 'displacement crisis', heat: 'heat crisis',
  disaster: 'disaster you were unprepared for', conflict: 'slide into conflict',
}

// The full epilogue text.
export function epilogue(g: GameRecord): string {
  const p = g.finalPlanet
  const lines: string[] = []
  const targets = assessTargets(g)
  const hits = targets.filter((t) => t.hit).length
  const peakRound = g.rounds.reduce((best, r) => (r.temp > best.temp ? r : best), g.rounds[0]!)
  const falling = p.tempAnomaly < g.peakTemp - 0.01

  lines.push('══════════════════════════════════════════════════════════════════')
  lines.push(`  ${p.year}.  WORLD STATE REPORT`)
  lines.push('══════════════════════════════════════════════════════════════════')
  lines.push('')
  const peakYear = 2026 + 2 * peakRound.round
  lines.push(
    `Emissions at ${p.annualEmissions.toFixed(0)} GtCO₂e. Temperature peaked at ` +
      `${g.peakTemp.toFixed(2)}°C in ${peakYear} and is ${falling ? 'now falling' : 'still rising'}. ` +
      `Forest loss ${p.forestLossRate <= 0.5 ? 'halted' : `running at ${p.forestLossRate.toFixed(0)} Mha/yr`}.`,
  )
  lines.push('')
  lines.push(`Cumulative excess deaths attributable to climate impacts, 2026 to ${p.year}: ${bn(g.totalDeaths)}.`)
  lines.push(`Displaced and not resettled: ${Math.round(p.displacedUnresettled)} million.`)
  const hardline = g.successions.filter((s) => s.archetype === 'populist' || s.archetype === 'nationalist').length
  if (hardline > 0) {
    lines.push(`Governments hardened into populist or nationalist hands during the mandate: ${hardline}.`)
  }
  lines.push('')

  // Planetary targets.
  lines.push(`Planetary targets met: ${hits} of ${targets.length}.`)
  for (const t of targets) {
    lines.push(`  ${t.hit ? '✓' : '✗'} ${t.name.padEnd(22)} ${t.actual.padEnd(20)} (goal ${t.goal})`)
  }
  lines.push('')

  // Ministers and forecasts.
  const vindSeat = g.vindicatedSeat
  const vindFell = g.vindicatedSeatFinalGeneration > 1
  const vindFellRounds = g.successions.filter((s) => s.portfolio === vindSeat).map((s) => s.round)
  lines.push(`${g.falls} ministers fell.`)
  lines.push('')

  // The named preventable moment — the accusation.
  const pv = namedPreventable(g)
  if (pv) {
    lines.push(
      `You held the line where you did by accepting a ${CRISIS_PHRASE[pv.channel]} you had the ` +
        `resources to prevent in Round ${pv.round} (${pv.year}) and chose not to: ${pv.policy} ` +
        `would have cost ${pv.points} points and cut ~${pv.avoided}M deaths that round. ` +
        `The cabinet left ${pv.unspent} points unspent.`,
    )
    lines.push('')
  }

  // The forecast reveal — which lens turned out to matter (not who was "right"; all models
  // were sound). The one that foregrounded the risk that did the most killing.
  lines.push('— — —')
  lines.push(
    `Of the six forecasts, the one that read this game closest was ${SEAT_NAME[vindSeat]}'s ` +
      `— "${g.forecasts[vindSeat].name}", which foregrounded ${g.vindicatedEmphasis}, and ${g.vindicatedEmphasis} is ` +
      `what did the most killing. ` +
      (vindFell
        ? `That office fell in round ${Math.min(...vindFellRounds)}; its warning was on the table the whole time.`
        : `They held their seat the whole mandate. Whether the cabinet listened is another question.`),
  )

  // The verdict.
  lines.push('')
  const verdict =
    hits >= 6 ? 'A survivable ending. It is not a good one, and the counter still rose.'
    : hits >= 3 ? 'Not survivable on the targets that mattered. The gap to the best available line was real, and you did not close it.'
    : 'A runaway. Most of what could be lost was lost.'
  lines.push(verdict)
  lines.push('══════════════════════════════════════════════════════════════════')
  return lines.join('\n')
}

function bn(millions: number): string {
  return millions >= 1000 ? `${(millions / 1000).toFixed(2)} billion` : `${Math.round(millions)} million`
}
