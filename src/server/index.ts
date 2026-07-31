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

// Fly's proxy (and other hops in between) can silently drop a quiet WebSocket without ever
// sending a close frame, leaving the client stuck on a socket that still reads as OPEN and
// never fires its reconnect logic. A ping/pong heartbeat forces that out into the open: any
// connection that misses a beat gets terminated, so the client's existing onclose→retry path
// actually runs instead of hanging silently.
const HEARTBEAT_MS = 20_000
const alive = new WeakMap<WebSocket, boolean>()

wss.on('connection', (ws) => {
  clients.add(ws)
  alive.set(ws, true)
  ws.on('pong', () => alive.set(ws, true))
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
    alive.delete(ws)
    // Deliberately NOT freeing the seat here — manual-only release, per the agreed design.
  })
})

const heartbeat = setInterval(() => {
  for (const ws of clients) {
    if (alive.get(ws) === false) {
      ws.terminate()
      continue
    }
    alive.set(ws, false)
    ws.ping()
  }
}, HEARTBEAT_MS)

wss.on('close', () => clearInterval(heartbeat))

console.log(`Game of Life multiplayer room listening on ws://localhost:${PORT}`)
