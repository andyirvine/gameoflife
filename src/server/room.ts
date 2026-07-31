import type { PortfolioId } from '../engine/types.ts'

// Phase 1: the shared-room state machine only. No engine/Session wiring yet — that lands in
// Phase 3, once the seat-claim and commit-gating protocol is proven out on its own. This file
// has zero dependency on ws/Node APIs so it can be unit-tested or reused as-is once the real
// round resolution is wired in.
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
}

export type ClaimResult = { ok: true } | { ok: false; error: string }

// Placeholder move shape for Phase 1 — real Committed[] from the engine lands in Phase 3.
// Kept intentionally opaque here; the room only needs to know THAT a seat committed, not
// what, until the engine is wired in.
export type PendingMoves = unknown

export class Room {
  private phase: Phase = 'lobby'
  private round = 1
  private seats: Record<PortfolioId, SeatClaim | null> = {
    energy: null, agriculture: null, treasury: null, foreign: null, environment: null, resilience: null,
  }
  private committed = new Set<PortfolioId>()
  private pendingMoves = new Map<PortfolioId, PendingMoves>()

  state(): RoomState {
    return {
      phase: this.phase,
      round: this.round,
      seats: { ...this.seats },
      committed: [...this.committed],
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
    }
    return { ok: true }
  }

  // Manual-only seat release (per the agreed design — no auto-timeout). Leaving mid-round
  // clears any commit already submitted for that seat; the round simply cannot resolve until
  // the seat is reclaimed and commits again. That stall is a known Phase-4 polish item, not
  // something this phase tries to paper over.
  leaveSeat(token: string): ClaimResult {
    const seat = PORTFOLIOS.find((p) => this.seats[p]?.token === token)
    if (!seat) return { ok: false, error: 'no seat held by this token' }
    this.seats[seat] = null
    this.committed.delete(seat)
    this.pendingMoves.delete(seat)
    if (this.phase !== 'lobby') this.phase = 'lobby'
    return { ok: true }
  }

  // Record a seat's commitment for the current round. Once every claimed seat has committed,
  // the round rolls over. Phase 1 stub: no engine call yet, just the gating mechanic itself.
  commitMoves(token: string, moves: PendingMoves): ClaimResult {
    if (this.phase !== 'round') return { ok: false, error: 'not currently collecting moves' }
    const seat = PORTFOLIOS.find((p) => this.seats[p]?.token === token)
    if (!seat) return { ok: false, error: 'you do not hold a seat' }
    if (this.committed.has(seat)) return { ok: false, error: 'already committed this round' }
    this.pendingMoves.set(seat, moves)
    this.committed.add(seat)
    if (this.committed.size === PORTFOLIOS.length) this.resolveRound()
    return { ok: true }
  }

  // Phase 1 stub resolution: roll the round counter and clear the commit buffer. Phase 3
  // replaces this body with the real engine call (Session.commit-equivalent) and produces a
  // reveal/resolution payload to broadcast instead of just incrementing a number.
  private resolveRound() {
    this.committed.clear()
    this.pendingMoves.clear()
    if (this.round >= 12) this.phase = 'epilogue'
    else this.round += 1
  }
}
