// Client-side networking for the multiplayer room. Thin on purpose: the server is the only
// authority, this just mirrors its broadcast state and forwards actions. Safe to import
// PORTFOLIOS/types from src/server/room.ts directly — that module has zero Node/`ws`
// dependency of its own (only src/server/index.ts does, and nothing here touches it).
import { useEffect, useRef, useState } from 'react'
import type { RoomState, PendingMoves } from '../server/room.ts'
import type { InMessage, OutMessage } from '../server/protocol.ts'
import type { PortfolioId } from '../engine/types.ts'

const TOKEN_KEY = 'gol-mp-token'

// A persistent, anonymous per-browser identity — no accounts. Reused across reloads so a
// refresh reclaims your seat instead of losing it.
export function getToken(): string {
  let token = localStorage.getItem(TOKEN_KEY)
  if (!token) {
    token = `p-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
    localStorage.setItem(TOKEN_KEY, token)
  }
  return token
}

function defaultWsUrl(): string {
  const fromEnv = (import.meta as { env?: Record<string, string> }).env?.VITE_WS_URL
  if (fromEnv) return fromEnv
  // Same host the page was loaded from, so it also works for a friend hitting the dev
  // server over the local network — not just localhost.
  return `ws://${location.hostname}:8787`
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'error'

export function useRoom() {
  const [state, setState] = useState<RoomState | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [lastError, setLastError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const token = useRef(getToken()).current

  useEffect(() => {
    let cancelled = false
    let ws: WebSocket
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (cancelled) return
      setStatus('connecting')
      ws = new WebSocket(defaultWsUrl())
      wsRef.current = ws

      ws.onopen = () => { if (!cancelled) setStatus('open') }
      ws.onmessage = (ev) => {
        const msg: OutMessage = JSON.parse(ev.data)
        if (cancelled) return
        if (msg.type === 'state') setState(msg.state)
        else if (msg.type === 'error') setLastError(msg.error)
      }
      ws.onerror = () => { if (!cancelled) setStatus('error') }
      ws.onclose = () => {
        if (cancelled) return
        setStatus('closed')
        // The room is meant to be one long-lived instance a small group reconnects to, so a
        // simple fixed retry is enough — no backoff/jitter machinery for a handful of players.
        retryTimer = setTimeout(connect, 1500)
      }
    }
    connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      wsRef.current?.close()
    }
  }, [])

  const send = (msg: InMessage) => wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify(msg))

  return {
    state, status, token, lastError,
    clearError: () => setLastError(null),
    claimSeat: (seat: PortfolioId, name: string) => send({ type: 'claim-seat', token, seat, name }),
    leaveSeat: () => send({ type: 'leave-seat', token }),
    commitMoves: (moves: PendingMoves) => send({ type: 'commit-moves', token, moves }),
  }
}
