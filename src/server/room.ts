import type { PlanetState, PortfolioId } from '../engine/types.ts'
import {
  MultiplayerSession, type SeatMove, type SeatSummary, type RoundReveal, type Newsflash, type EpilogueSummary,
} from './multiplayer-session.ts'

// The shared-room state machine, now wired to the real engine (MultiplayerSession) for round
// resolution. This file has zero dependency on ws/Node APIs so it can be unit-tested or reused
// as-is by the browser client.
//
// One process holds exactly one Room ("I only need to run one instance at a time") — there is
// no multi-room/matchmaking concept here by design.

// Duplicated from src/ui/session.ts's PORTFOLIOS rather than imported from it: that module is
// the *client's* session wrapper, and the server shouldn't reach into the UI layer to get a
// plain list of six strings. If this drifts, both are trivially checked against PortfolioId.
export const PORTFOLIOS: PortfolioId[] = ['energy', 'agriculture', 'treasury', 'foreign', 'environment', 'resilience']

export type Phase = 'lobby' | 'round' | 'epilogue'

export type SeatClaim = { token: string; name: string }

export type RoomState = {
  phase: Phase
  round: number
  seats: Record<PortfolioId, SeatClaim | null>
  committed: PortfolioId[]   // seats that have submitted moves for the CURRENT round
  cabinet: SeatSummary[] | null       // null until the game has started
  lastReveal: RoundReveal | null      // the most recently resolved round's outcome, for the reveal beat
  planet: PlanetState | null          // null until the game has started
  history: { round: number; year: number; temp: number; deaths: number; unresettled: number }[]
  newsflash: Newsflash | null         // the CURRENT round's world-level flavour (same for all 6 seats)
  epilogue: EpilogueSummary | null    // populated once phase becomes 'epilogue'
}

export type ClaimResult = { ok: true } | { ok: false; error: string }

// What a client sends when committing: its own seat's chosen policies for this round.
export type PendingMoves = SeatMove[]

export class Room {
  private phase: Phase = 'lobby'
  private round = 1
  private seats: Record<PortfolioId, SeatClaim | null> = {
    energy: null, agriculture: null, treasury: null, foreign: null, environment: null, resilience: null,
  }
  private committed = new Set<PortfolioId>()
  private pendingMoves = new Map<PortfolioId, PendingMoves>()
  private session: MultiplayerSession | null = null

  state(): RoomState {
    return {
      phase: this.phase,
      round: this.round,
      seats: { ...this.seats },
      committed: [...this.committed],
      cabinet: this.session?.cabinetSummary() ?? null,
      lastReveal: this.session?.lastReveal ?? null,
      planet: this.session?.planetState() ?? null,
      history: this.session?.history ?? [],
      newsflash: this.phase === 'round' ? (this.session?.newsflash() ?? null) : null,
      epilogue: this.phase === 'epilogue' ? (this.session?.epilogueSummary() ?? null) : null,
    }
  }

  // Claim a seat, or reclaim your own (same token) after a refresh. Rejects a claim on a seat
  // already held by a DIFFERENT token. Claiming is only meaningful in the lobby — once the
  // game has started, seats are fixed for the round (see leaveSeat for the mid-game case).
  claimSeat(token: string, seat: PortfolioId, name: string): ClaimResult {
    const existing = this.seats[seat]
    if (existing && existing.token !== token) return { ok: false, error: 'seat already taken' }
    if (this.phase !== 'lobby' && !existing) return { ok: false, error: 'game already in progress' }
    this.seats[seat] = { token, name: name.trim().slice(0, 24) || 'Minister' }
    if (this.phase === 'lobby' && PORTFOLIOS.every((p) => this.seats[p] !== null)) {
      this.phase = 'round'
      this.round = 1
      this.session = new MultiplayerSession(Date.now())
    }
    return { ok: true }
  }

  // Manual-only seat release (per the agreed design — no auto-timeout). Leaving mid-round
  // clears any commit already submitted for that seat; the round simply cannot resolve until
  // the seat is reclaimed and commits again. That stall is a known Phase-4 polish item, not
  // something this phase tries to paper over. Leaving also discards the in-progress session —
  // the game restarts from round 1 once the seat is reclaimed and the 6th seat completes again.
  leaveSeat(token: string): ClaimResult {
    const seat = PORTFOLIOS.find((p) => this.seats[p]?.token === token)
    if (!seat) return { ok: false, error: 'no seat held by this token' }
    this.seats[seat] = null
    this.committed.delete(seat)
    this.pendingMoves.delete(seat)
    if (this.phase !== 'lobby') {
      this.phase = 'lobby'
      this.session = null
    }
    return { ok: true }
  }

  // Record a seat's commitment for the current round. Once every claimed seat has committed,
  // the round rolls over via the real engine (MultiplayerSession).
  commitMoves(token: string, moves: PendingMoves): ClaimResult {
    if (this.phase !== 'round' || !this.session) return { ok: false, error: 'not currently collecting moves' }
    const seat = PORTFOLIOS.find((p) => this.seats[p]?.token === token)
    if (!seat) return { ok: false, error: 'you do not hold a seat' }
    if (this.committed.has(seat)) return { ok: false, error: 'already committed this round' }
    this.pendingMoves.set(seat, moves)
    this.committed.add(seat)
    if (this.committed.size === PORTFOLIOS.length) this.resolveRound()
    return { ok: true }
  }

  private resolveRound() {
    const session = this.session
    if (!session) return
    const moves: Partial<Record<PortfolioId, PendingMoves>> = {}
    for (const [seat, mv] of this.pendingMoves) moves[seat] = mv
    session.resolve(moves)
    this.committed.clear()
    this.pendingMoves.clear()
    this.round = session.round
    if (this.round >= 12 && session.lastReveal?.round === 12) this.phase = 'epilogue'
  }
}
