import { WebSocketServer, type WebSocket } from 'ws'
import { Room } from './room.ts'
import type { InMessage, OutMessage } from './protocol.ts'

// The one-and-only room for this process ("I only need to run one instance at a time" — no
// matchmaking, no multi-room registry).
const room = new Room()

const PORT = Number(process.env.PORT ?? 8787)
const wss = new WebSocketServer({ port: PORT })
const clients = new Set<WebSocket>()

function broadcastState() {
  const msg: OutMessage = { type: 'state', state: room.state() }
  const payload = JSON.stringify(msg)
  for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(payload)
}

function send(ws: WebSocket, msg: OutMessage) {
  ws.send(JSON.stringify(msg))
}

wss.on('connection', (ws) => {
  clients.add(ws)
  send(ws, { type: 'state', state: room.state() })

  ws.on('message', (raw) => {
    let msg: InMessage
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      send(ws, { type: 'error', error: 'malformed message' })
      return
    }

    let result: { ok: true } | { ok: false; error: string }
    switch (msg.type) {
      case 'claim-seat':
        result = room.claimSeat(msg.token, msg.seat, msg.name)
        break
      case 'leave-seat':
        result = room.leaveSeat(msg.token)
        break
      case 'commit-moves':
        result = room.commitMoves(msg.token, msg.moves)
        break
      default:
        result = { ok: false, error: `unknown message type` }
    }

    if (!result.ok) send(ws, { type: 'error', error: result.error })
    else broadcastState()  // broadcast on every successful mutation, including to the sender
  })

  ws.on('close', () => {
    clients.delete(ws)
    // Deliberately NOT freeing the seat here — manual-only release, per the agreed design.
  })
})

console.log(`Game of Life multiplayer room listening on ws://localhost:${PORT}`)
