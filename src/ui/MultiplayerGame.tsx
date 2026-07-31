import { useState } from 'react'
import { useRoom } from './net.ts'
import { PORTFOLIOS } from '../server/room.ts'
import type { RoomState } from '../server/room.ts'
import { SEAT_NAME } from './session.ts'
import { buildMenu, type MenuTier } from '../engine/menu.ts'
import type { Committed, PortfolioId, Severity } from '../engine/types.ts'

const bn = (m: number) => (m / 1000).toFixed(2)

// Local-only pre-commit stage: everyone flips through their own briefing/options at their own
// pace (no network wait). `pendingRound` tracks the round we've committed for but not yet
// walked through the reveal for — it, not `state.committed` (which the server clears the
// instant the round resolves), is what decides whether we're waiting or ready to reveal.
type Stage = 'brief' | 'options'

export function MultiplayerGame({ state, mySeat, seatState }: {
  state: RoomState
  mySeat: PortfolioId
  seatState: ReturnType<typeof useRoom>
}) {
  const [stage, setStage] = useState<Stage>('brief')
  const [selected, setSelected] = useState<{ policyId: string; severity: Severity }[]>([])
  const [pendingRound, setPendingRound] = useState<number | null>(null)
  const [ackedRound, setAckedRound] = useState(0)

  if (pendingRound !== null) {
    if (state.lastReveal?.round === pendingRound) {
      return (
        <Reveal
          reveal={state.lastReveal}
          onNext={() => { setAckedRound(pendingRound); setPendingRound(null); setStage('brief') }}
        />
      )
    }
    return <Waiting state={state} mySeat={mySeat} />
  }

  if (state.phase === 'epilogue' && state.epilogue && ackedRound >= 12) {
    return <MultiplayerEpilogue epilogue={state.epilogue} />
  }

  if (!state.cabinet || !state.planet) return null

  if (stage === 'brief') {
    return <Brief state={state} onNext={() => setStage('options')} />
  }

  return (
    <Options
      state={state}
      mySeat={mySeat}
      selected={selected}
      setSelected={setSelected}
      onCommit={() => {
        setPendingRound(state.round)
        seatState.commitMoves(selected)
        setSelected([])
      }}
    />
  )
}

function Header({ tag, title, sub }: { tag: string; title: string; sub?: string }) {
  return (
    <div className="mh">
      <div className="s" style={{ letterSpacing: 3, fontSize: 10 }}>{tag}</div>
      <div className="t" style={{ fontSize: 20 }}>{title}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  )
}

function Brief({ state, onNext }: { state: RoomState; onNext: () => void }) {
  const p = state.planet!
  return (
    <div className="modal theatre rail">
      <Header tag={`ROUND ${state.round} OF 12 · ${p.year}`} title="THE SITUATION" sub="The cabinet convenes." />
      <div className="mb">
        <p className="lead">
          Temperature anomaly is {p.tempAnomaly.toFixed(2)}°C. {bn(p.cumulativeDeaths)} billion have died due to climate change so far.
        </p>
        <p className="dim">Coalition emits {p.coalitionEmissions.toFixed(0)} Gt. The world emits {p.nonMemberEmissions.toFixed(0)} Gt.</p>
        {state.newsflash && (
          <>
            <hr className="rule" />
            <div className="dim" style={{ letterSpacing: 2, fontSize: 10 }}>Political Events</div>
            <div className={`card ${state.newsflash.worldCard.tone}`} style={{ marginTop: 6 }}>
              <div className="nm" style={{ fontSize: 14 }}>{state.newsflash.worldCard.name}</div>
              <div className="fl">{state.newsflash.worldCard.flavor}</div>
            </div>
            <div className="dim" style={{ letterSpacing: 2, fontSize: 10, marginTop: 12 }}>Major Global Events</div>
            {state.newsflash.events.length === 0 && <p className="dim" style={{ marginTop: 6 }}>The world holds its breath — no physical shocks this round.</p>}
            {state.newsflash.events.map((e, i) => (
              <div key={i} className={`card ${e.feedback ? 'feedback' : 'hostile'}`} style={{ marginTop: 6 }}>
                <div className="nm" style={{ fontSize: 14 }}>{e.name}{e.feedback && ' ⚡ FEEDBACK LOOP'}</div>
                <div className="fl">{e.flavor}</div>
              </div>
            ))}
          </>
        )}
        <div className="committray">
          <div className="dim">The cabinet turns to you.</div>
          <button className="act" onClick={onNext}>TAKE THE FLOOR ▸</button>
        </div>
      </div>
    </div>
  )
}

function Waiting({ state, mySeat }: { state: RoomState; mySeat: PortfolioId }) {
  const waitingOn = PORTFOLIOS.filter((p) => state.seats[p] && !state.committed.includes(p))
  return (
    <div className="modal theatre rail">
      <Header tag={`ROUND ${state.round} · YOU HAVE COMMITTED`} title="WAITING ON THE CABINET" />
      <div className="mb">
        <p className="dim">Your move is locked in. Once every seat has committed, the round resolves for everyone at once.</p>
        <div className="seatpick">
          {PORTFOLIOS.map((p) => (
            <div key={p} className={`seat${p === mySeat ? ' on' : ''}${state.committed.includes(p) ? ' ok' : ''}`}>
              <b>{SEAT_NAME[p]}</b>
              <span>{state.committed.includes(p) ? 'committed' : 'deciding…'}</span>
            </div>
          ))}
        </div>
        {waitingOn.length > 0 && <p className="dim">Waiting on: {waitingOn.map((p) => SEAT_NAME[p]).join(', ')}.</p>}
      </div>
    </div>
  )
}

function Options({ state, mySeat, selected, setSelected, onCommit }: {
  state: RoomState
  mySeat: PortfolioId
  selected: { policyId: string; severity: Severity }[]
  setSelected: (f: (x: { policyId: string; severity: Severity }[]) => { policyId: string; severity: Severity }[]) => void
  onCommit: () => void
}) {
  const you = state.cabinet!.find((c) => c.portfolio === mySeat)!
  const healthOf = Object.fromEntries(state.cabinet!.map((c) => [c.portfolio, c.health])) as Record<PortfolioId, number>
  const committed: Committed[] = selected.map((s) => ({ ...s, by: mySeat }))
  const menu = buildMenu(mySeat, you, you.budget, healthOf, committed)
  const remaining = you.budget - selected.reduce((a, m) => a + (menu.find((x) => x.policyId === m.policyId && x.severity === m.severity)?.cost ?? 0), 0)
  const remove = (i: number) => setSelected((x) => x.filter((_, j) => j !== i))
  const toggle = (t: MenuTier) => {
    if (t.disabled && !t.selected) return
    if (t.selected) setSelected((x) => x.filter((sel) => !(sel.policyId === t.policyId && sel.severity === t.severity)))
    else setSelected((x) => [...x, { policyId: t.policyId, severity: t.severity }])
  }
  const groups: { id: string; name: string; summary: string; tiers: MenuTier[] }[] = []
  for (const t of menu) { let g = groups.find((x) => x.id === t.policyId); if (!g) { g = { id: t.policyId, name: t.policyName, summary: t.summary, tiers: [] }; groups.push(g) } g.tiers.push(t) }
  const allDisabled = menu.every((t) => t.disabled)

  return (
    <div className="modal theatre rail">
      <Header tag={`ROUND ${state.round} · YOUR MOVE`} title={SEAT_NAME[mySeat].toUpperCase()} sub={`health ${you.health.toFixed(1)}/10 · ${remaining}/${you.budget} points · ${you.doctrine}`} />
      <div className="mb" style={{ maxHeight: '62vh', overflow: 'auto' }}>
        {you.restrictions.length > 0 && <div className="hot" style={{ fontSize: 11 }}>🔒 locked out of: {you.restrictions.map((r) => r.forbidsFlag).join(', ')}</div>}
        {groups.map((g) => (
          <div key={g.id} className="policy">
            <div className="ph"><b>{g.name}</b> — <span>{g.summary}</span></div>
            {g.tiers.map((t) => (
              <div
                key={t.severity}
                className={`tier${t.disabled ? ' disabled' : ''}${t.selected ? ' selected' : ''}`}
                onClick={() => toggle(t)}
              >
                <span className={`chk${t.selected ? ' checked' : ''}`} aria-hidden="true" />
                <span className={`sev ${t.severity}`}>{t.severity}</span>
                <span className="cost">{t.cost}p·L{t.lag}</span>
                <span className="eff">{t.effect}</span>
                <span className="pol">
                  you {t.selfCost > 0 ? `-${t.selfCost}` : t.selfCost < 0 ? `+${-t.selfCost}` : '0'}
                  {t.spill.map((sp) => (
                    <span key={sp.seat} className={sp.resultHealth <= 0 ? 'topple' : sp.amount < 0 ? 'props' : ''}>
                      {' '}{SEAT_NAME[sp.seat].split(' ')[0]} {sp.amount > 0 ? `-${sp.amount}` : `+${-sp.amount}`}{sp.resultHealth <= 0 ? '✖' : ''}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
        {allDisabled && <div className="dim">Nothing legal and affordable remains. You must hold.</div>}
      </div>
      <div className="mb" style={{ paddingTop: 0 }}>
        <div className="committray">
          <div className="chips">
            {selected.length === 0 && <span className="dim">holding — a round of recovery. The counter rises regardless.</span>}
            {selected.map((m, i) => <span key={i} className="chip" onClick={() => remove(i)}>{m.policyId.split('-')[0]} {m.severity[0]} ✕</span>)}
          </div>
          <button className="act" onClick={onCommit}>{selected.length ? 'COMMIT ▸' : 'HOLD ▸'}</button>
        </div>
      </div>
    </div>
  )
}

function Reveal({ reveal, onNext }: { reveal: NonNullable<RoomState['lastReveal']>; onNext: () => void }) {
  const CH: (keyof typeof reveal.byChannel)[] = ['heat', 'food', 'displacement', 'disaster', 'conflict']
  return (
    <div className="modal theatre rail">
      <Header tag={`ROUND ${reveal.round} RESOLVES · ${reveal.year}`} title="THE CABINET REVEALS" sub="What the whole table committed, and what it cost." />
      <div className="mb" style={{ maxHeight: '64vh', overflow: 'auto' }}>
        {PORTFOLIOS.map((p) => {
          const moves = reveal.moves.filter((m) => m.seat === p)
          return (
            <div key={p} className="cab-row">
              <div className="cab-head"><b>{SEAT_NAME[p]}</b></div>
              {moves.length > 0 ? moves.map((m, i) => (
                <div key={i} className="cab-move">
                  <span className="cab-policy">{m.policyName} ({m.severity})</span>
                  <span className="dim">lags {m.lag} → lands round {m.landsRound}{m.landsRound > 12 ? ' (too late)' : ''}</span>
                </div>
              )) : (
                <div className="cab-move">
                  <span className="cab-badge cab-hold">HOLDING</span>
                </div>
              )}
            </div>
          )
        })}
        {reveal.successions.map((sx, i) => (
          <p key={i} className="hot">↳ {SEAT_NAME[sx.portfolio]} fell ({sx.cause}) → a {sx.archetype} takes the seat.</p>
        ))}

        <hr className="rule" />
        <div className="dim" style={{ letterSpacing: 2, fontSize: 10 }}>THE WORLD ABSORBS IT —</div>
        <p><span className="hot toll" style={{ fontSize: 16 }}>{reveal.total.toFixed(0)} million died this round.</span></p>
        <div className="chanrow" style={{ marginBottom: 8 }}>
          {CH.map((ch) => <span key={ch}>{ch} <b>{reveal.byChannel[ch].toFixed(0)}</b></span>)}
        </div>
        <p>The counter climbs to <b className="hot">{bn(reveal.cumulative)} billion</b>.</p>

        <div className="committray">
          <div className="dim">{reveal.round >= 12 ? 'The mandate is over. Four years pass...' : 'The next round assembles.'}</div>
          <button className="act" onClick={onNext}>{reveal.round >= 12 ? 'READ THE FINAL REPORT ▸' : 'NEXT ROUND ▸'}</button>
        </div>
      </div>
    </div>
  )
}

function MultiplayerEpilogue({ epilogue }: { epilogue: NonNullable<RoomState['epilogue']> }) {
  const d = epilogue
  const verdict = d.targetsHit >= 6 ? 'A survivable ending. It is not a good one, and the counter still rose.'
    : d.targetsHit >= 3 ? 'Not survivable on the targets that mattered.'
    : 'A runaway. Most of what could be lost was lost.'
  return (
    <div className="modal-scrim">
      <div className="modal">
        <div className="mh">
          <div className="t">{d.year} · WORLD STATE REPORT</div>
          <div className="s">Four years after your mandate ended. Your final decisions have landed.</div>
        </div>
        <div className="mb">
          <p className="lead">
            Temperature peaked at {d.peakTemp.toFixed(2)}°C and is {d.falling ? 'now falling' : 'still rising'}.
          </p>
          <p><span className="hot" style={{ fontSize: 16 }}>Cumulative excess deaths: {bn(d.cumulativeDeaths)} billion.</span><br />
            <span className="dim">{d.falls} ministers fell across the mandate.</span></p>
          <div className="epi-targets">
            {d.targets.map((t) => (
              <div key={t.name} className={`t ${t.hit ? 'hit' : 'miss'}`}>
                <span className="mark">{t.hit ? '✓' : '✗'}</span> {t.name} <span className="val">{t.actual}</span>
              </div>
            ))}
          </div>
          <div className="dim">Planetary targets met: {d.targetsHit} of 9. The channel that did the most killing was <b>{d.dominant}</b>.</div>
          <div className="verdict">{verdict}</div>
        </div>
      </div>
    </div>
  )
}

