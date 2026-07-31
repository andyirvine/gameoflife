// The wire protocol, shared by the server and the browser client. Deliberately has zero
// dependency on `ws` or any Node API — src/server/index.ts's WebSocketServer starts listening
// as a side effect of import, so nothing browser-facing may import that module directly.
import type { PortfolioId } from '../engine/types.ts'
import type { PendingMoves, RoomState } from './room.ts'

// Client -> server.
export type InMessage =
  | { type: 'claim-seat'; token: string; seat: PortfolioId; name: string }
  | { type: 'leave-seat'; token: string }
  | { type: 'commit-moves'; token: string; moves: PendingMoves }

// Server -> client. Just one real message: the full room state, pushed to everyone after any
// mutation. Clients are thin mirrors, not co-authorities.
export type OutMessage =
  | { type: 'state'; state: RoomState }
  | { type: 'error'; error: string }
