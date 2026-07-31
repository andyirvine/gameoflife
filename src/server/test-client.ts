// Scratch verification script for the Phase 1 room protocol — NOT part of the app. Spins up
// six raw WebSocket clients against a running `npm run server`, exercises claim/commit/leave,
// and asserts the gating mechanic actually gates. Run `npm run server` in one terminal, then
// `npm run server:test` in another.

import WebSocket from 'ws'
import type { PortfolioId } from '../engine/types.ts'

const PORT = Number(process.env.PORT ?? 8787)
const URL = `ws://localhost:${PORT}`
const PORTFOLIOS: PortfolioId[] = ['energy', 'agriculture', 'treasury', 'foreign', 'environment', 'resilience']

let passed = 0
let failed = 0
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ok   ${label}`) }
  else { failed++; console.log(`  FAIL ${label}`) }
}

type State = {
  phase: 'lobby' | 'round' | 'epilogue'
  round: number
  seats: Record<PortfolioId, { token: string; name: string } | null>
  committed: PortfolioId[]
}

class Client {
  ws: WebSocket
  token: string
  state: State | null = null
  private waiters: ((s: State) => boolean)[] = []

  constructor(token: string) {
    this.token = token
    this.ws = new WebSocket(URL)
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'state') {
        this.state = msg.state
        this.waiters = this.waiters.filter((w) => !w(msg.state))
      }
      if (msg.type === 'error') console.log(`    (server error to ${this.token}: ${msg.error})`)
    })
  }

  ready(): Promise<void> {
    return new Promise((res) => this.ws.on('open', () => res()))
  }

  send(msg: object) { this.ws.send(JSON.stringify(msg)) }

  // Wait until a state update satisfies `pred`, or time out.
  untilState(pred: (s: State) => boolean, ms = 1500): Promise<State> {
    return new Promise((resolve, reject) => {
      if (this.state && pred(this.state)) { resolve(this.state); return }
      const timeout = setTimeout(() => reject(new Error('timed out waiting for state')), ms)
      this.waiters.push((s) => {
        if (pred(s)) { clearTimeout(timeout); resolve(s); return true }
        return false
      })
    })
  }
}

async function main() {
  console.log(`Connecting 6 clients to ${URL} ...\n`)
  const clients = PORTFOLIOS.map((_, i) => new Client(`token-${i}`))
  await Promise.all(clients.map((c) => c.ready()))

  // --- claim all six seats ---
  PORTFOLIOS.forEach((seat, i) => clients[i]!.send({ type: 'claim-seat', token: clients[i]!.token, seat, name: `Player ${i + 1}` }))
  const afterClaims = await clients[5]!.untilState((s) => PORTFOLIOS.every((p) => s.seats[p] !== null))
  check('all six seats claimed', PORTFOLIOS.every((p) => afterClaims.seats[p] !== null))
  check('phase auto-started (lobby -> round)', afterClaims.phase === 'round')
  check('round starts at 1', afterClaims.round === 1)

  // --- a conflicting claim on an already-taken seat must fail ---
  const intruder = new Client('token-intruder')
  await intruder.ready()
  let gotError = false
  intruder.ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.type === 'error') gotError = true })
  intruder.send({ type: 'claim-seat', token: intruder.token, seat: 'energy', name: 'Intruder' })
  await new Promise((r) => setTimeout(r, 300))
  check('claiming an already-held seat is rejected', gotError)

  // --- gating: 5 of 6 commit, round must NOT advance ---
  for (let i = 0; i < 5; i++) clients[i]!.send({ type: 'commit-moves', token: clients[i]!.token, moves: { note: `move-${i}` } })
  await new Promise((r) => setTimeout(r, 300))
  check('5 committed, round still 1 (gated)', clients[0]!.state!.round === 1)
  check('committed count is 5', clients[0]!.state!.committed.length === 5)

  // --- the 6th commits, round must advance and the buffer resets ---
  clients[5]!.send({ type: 'commit-moves', token: clients[5]!.token, moves: { note: 'move-5' } })
  const afterRound = await clients[0]!.untilState((s) => s.round === 2)
  check('all 6 committed -> round advanced to 2', afterRound.round === 2)
  check('commit buffer reset for the new round', afterRound.committed.length === 0)

  // --- leave-seat frees the seat and drops the game back to lobby ---
  clients[0]!.send({ type: 'leave-seat', token: clients[0]!.token })
  const afterLeave = await clients[1]!.untilState((s) => s.seats.energy === null)
  check('leaving frees the seat', afterLeave.seats.energy === null)
  check('losing a seat mid-game drops the room back to lobby', afterLeave.phase === 'lobby')

  console.log(`\n${passed} passed, ${failed} failed.`)
  for (const c of [...clients, intruder]) c.ws.close()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
