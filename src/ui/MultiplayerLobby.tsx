import { useState } from 'react'
import { useRoom } from './net.ts'
import { PORTFOLIOS } from '../server/room.ts'
import { SEAT_NAME, SEAT_WEAKNESS } from './session.ts'

const NAME_KEY = 'gol-mp-name'

// Phase 2: live seat-claiming across however many browsers connect, wired to the real
// multiplayer server. Once all six seats are claimed the room auto-starts (phase becomes
// 'round' server-side) — this screen shows a plain placeholder for that instead of routing
// into Dashboard/Theatre, which is Phase 3's job (wiring the real engine to the network).
export function MultiplayerLobby({ onExit }: { onExit: () => void }) {
  const { state, status, token, lastError, clearError, claimSeat, leaveSeat } = useRoom()
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '')

  const commitName = (v: string) => {
    setName(v)
    localStorage.setItem(NAME_KEY, v)
  }

  const mySeat = state ? PORTFOLIOS.find((p) => state.seats[p]?.token === token) : undefined
  const claimedCount = state ? PORTFOLIOS.filter((p) => state.seats[p]).length : 0

  return (
    <div className="modal-scrim">
      <div className="modal">
        <div className="mh">
          <div className="t">MULTIPLAYER LOBBY</div>
          <div className="s">Six seats, six people. The game starts the moment the last one is claimed.</div>
        </div>

        <div className="mb">
          {status !== 'open' && (
            <p className={status === 'error' || status === 'closed' ? 'warn' : 'dim'}>
              {status === 'connecting' && 'Connecting to the multiplayer server…'}
              {status === 'error' && "Can't reach the multiplayer server. Is `npm run server` running?"}
              {status === 'closed' && 'Disconnected — retrying…'}
            </p>
          )}

          {lastError && (
            <p className="warn" onClick={clearError} style={{ cursor: 'pointer' }}>⚠ {lastError} (click to dismiss)</p>
          )}

          {status === 'open' && state && (
            <>
              {!mySeat && (
                <div style={{ marginBottom: 10 }}>
                  <div className="dim" style={{ marginBottom: 4 }}>Your name, before you take a seat:</div>
                  <input
                    className="mp-name-input"
                    value={name}
                    maxLength={24}
                    placeholder="Minister of..."
                    onChange={(e) => commitName(e.target.value)}
                  />
                </div>
              )}

              <div className="dim" style={{ marginBottom: 6 }}>
                {claimedCount} of {PORTFOLIOS.length} seats claimed
                {state.phase !== 'lobby' && <span className="ok"> — the cabinet has convened.</span>}
              </div>

              <div className="seatpick">
                {PORTFOLIOS.map((p) => {
                  const claim = state.seats[p]
                  const isMine = claim?.token === token
                  const takenByOther = claim && !isMine
                  return (
                    <div
                      key={p}
                      className={`seat${isMine ? ' on' : ''}${takenByOther ? ' mp-taken' : ''}`}
                      onClick={() => {
                        if (!claim && !mySeat && name.trim()) claimSeat(p, name)
                      }}
                      style={{ cursor: !claim && !mySeat && name.trim() ? 'pointer' : 'default' }}
                    >
                      <b>{SEAT_NAME[p]}</b>
                      <span>{SEAT_WEAKNESS[p]}</span>
                      {claim && (
                        <span className={isMine ? 'ok' : 'dim'} style={{ display: 'block', marginTop: 4, fontStyle: 'italic' }}>
                          {isMine ? `you — ${claim.name}` : claim.name}
                        </span>
                      )}
                      {!claim && !mySeat && !name.trim() && (
                        <span className="dim" style={{ display: 'block', marginTop: 4, fontStyle: 'italic' }}>enter a name to claim</span>
                      )}
                    </div>
                  )
                })}
              </div>

              {state.phase === 'lobby' ? (
                <div className="committray">
                  <div className="dim">{mySeat ? `You hold ${SEAT_NAME[mySeat]}. Waiting for the rest of the cabinet…` : 'Pick a seat above once you have a name.'}</div>
                  {mySeat && <button className="ghost" onClick={leaveSeat}>LEAVE SEAT</button>}
                </div>
              ) : (
                <div className="committray">
                  <div className="dim">GAME STARTING — round {state.round}. (The live gameplay screen lands in the next build.)</div>
                  {mySeat && <button className="ghost" onClick={leaveSeat}>LEAVE SEAT</button>}
                </div>
              )}
            </>
          )}

          <div className="committray" style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div className="dim">Playing solo instead?</div>
            <button className="ghost" onClick={onExit}>◂ BACK TO THE BRIEFING</button>
          </div>
        </div>
      </div>
    </div>
  )
}
