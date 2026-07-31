import { useState } from 'react'
import { Session, SEAT_NAME } from './session.ts'
import type { CabinetRecord, MenuTier } from './session.ts'
import type { Committed, DeathChannel, PortfolioId } from '../engine/types.ts'

const bn = (m: number) => (m / 1000).toFixed(2)
const CH: DeathChannel[] = ['heat', 'food', 'displacement', 'disaster', 'conflict']
type Stage = 'diagnosis' | 'events' | 'options' | 'cabinet' | 'resolution'
const STAGES: Stage[] = ['diagnosis', 'events', 'options', 'cabinet', 'resolution']

// What the cabinet beat needs, frozen at the moment you commit — the AI's moves are decided
// at the top of the round (independent of your choice), but committing immediately advances
// the session to the next round internally, which would overwrite them before this beat gets
// to render. Freezing this snapshot is what lets the reveal show THIS round's cabinet, not
// next round's.
type FrozenCabinet = { round: number; year: number; records: CabinetRecord[] }

export function Theatre({ session, onCommit, onEpilogue }: { session: Session; onCommit: (m: Committed[]) => void; onEpilogue: () => void }) {
  const [stage, setStage] = useState<Stage>('diagnosis')
  const [selected, setSelected] = useState<Committed[]>([])
  const [frozenCabinet, setFrozenCabinet] = useState<FrozenCabinet | null>(null)
  const s = session.snapshot()

  const commit = () => {
    setFrozenCabinet({ round: s.round, year: s.year, records: s.cabinetRecords })
    onCommit(selected)
    setSelected([])
    setStage('cabinet')
  }
  const advance = () => {
    if (stage === 'resolution') {
      if (session.phase === 'epilogue') { onEpilogue(); return }
      setStage('diagnosis')
      return
    }
    setStage(STAGES[STAGES.indexOf(stage) + 1]!)
  }

  return (
    <div className="modal theatre rail">
      <div className="beatdots">
        {STAGES.map((st) => <span key={st} className={`dot${st === stage ? ' on' : ''}${STAGES.indexOf(st) < STAGES.indexOf(stage) ? ' done' : ''}`} />)}
      </div>
      <div className="stage-anim" key={stage}>
        {stage === 'diagnosis' && <Diagnosis s={s} lines={session.diagnosis()} onNext={advance} />}
        {stage === 'events' && <Events s={s} onNext={advance} />}
        {stage === 'options' && (
          <Options session={session} s={s} advisors={session.briefing()} selected={selected} setSelected={setSelected} onCommit={commit} />
        )}
        {stage === 'cabinet' && frozenCabinet && <CabinetBeat data={frozenCabinet} onNext={advance} />}
        {stage === 'resolution' && s.lastConsequence && <Resolution s={s} onNext={advance} last={session.phase === 'epilogue'} />}
      </div>
    </div>
  )
}

type Snap = ReturnType<Session['snapshot']>

function Header({ tag, title, sub }: { tag: string; title: string; sub?: string }) {
  return (
    <div className="mh">
      <div className="s" style={{ letterSpacing: 3, fontSize: 10 }}>{tag}</div>
      <div className="t" style={{ fontSize: 20 }}>{title}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  )
}

function Diagnosis({ s, lines, onNext }: { s: Snap; lines: string[]; onNext: () => void }) {
  return (
    <>
      <Header tag={`ROUND ${s.round} OF 12 · ${s.year}`} title="THE SITUATION" sub="The advisors table their assessment." />
      <div className="mb">
        {lines.map((l, i) => <p key={i} className={i === 0 ? 'lead' : 'dim'}>{l}</p>)}
        <div className="committray">
          <div className="dim">The world will not wait for you.</div>
          <button className="act" onClick={onNext}>NEXT ▸</button>
        </div>
      </div>
    </>
  )
}

function Events({ s, onNext }: { s: Snap; onNext: () => void }) {
  return (
    <>
      <Header tag={`ROUND ${s.round} · PHASE I`} title="NEWSFLASH" sub="" />
      <div className="mb">
        <div className="dim" style={{ letterSpacing: 2, fontSize: 10 }}>Political Events</div>
        <div className={`card ${s.worldCard.tone}`} style={{ marginTop: 6 }}>
          <div className="nm" style={{ fontSize: 14 }}>{s.worldCard.name}</div>
          <div className="fl">{s.worldCard.flavor}</div>
        </div>
        <div className="dim" style={{ letterSpacing: 2, fontSize: 10, marginTop: 12 }}>Major Global Events</div>
        {s.events.length === 0 && <p className="dim" style={{ marginTop: 6 }}>The world holds its breath. No physical shocks this round — but the odds only ever worsen.</p>}
        {s.events.map((e, i) => (
          <div key={i} className={`card ${e.feedback ? 'feedback' : 'hostile'}`} style={{ marginTop: 6 }}>
            <div className="nm" style={{ fontSize: 14 }}>{e.name}{e.feedback && ' ⚡ FEEDBACK LOOP'}</div>
            <div className="fl">{e.flavor}</div>
          </div>
        ))}
        {s.pulledForward.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="hot" style={{ fontSize: 11 }}>⚡ The feedback shortens the pipeline — policies race a faster clock:</div>
            {s.pulledForward.map((p, i) => <div key={i} className="dim" style={{ fontSize: 11 }}>{p}</div>)}
          </div>
        )}
        <div className="committray">
          <div className="dim">The cabinet turns to you.</div>
          <button className="act" onClick={onNext}>TAKE THE FLOOR ▸</button>
        </div>
      </div>
    </>
  )
}

const PRIORITY_LABEL: Record<'mitigation' | 'relief' | 'resilience', string> = {
  mitigation: 'MITIGATION', relief: 'RELIEF', resilience: 'RESILIENCE',
}

function CabinetBeat({ data, onNext }: { data: { round: number; year: number; records: CabinetRecord[] }; onNext: () => void }) {
  const records = data.records
  const acted = records.filter((r) => r.move)
  const held = records.filter((r) => !r.move)
  const heldForStanding = held.filter((r) => r.holdReason === 'protecting-standing')
  const tally = (p: 'mitigation' | 'relief' | 'resilience') => acted.filter((r) => r.move!.priority === p).length

  return (
    <>
      <Header
        tag={`ROUND ${data.round} · PHASE V`}
        title="THE CABINET REVEALS"
        sub="Your own commitment is already locked in — this is what the rest of the table did at the same time."
      />
      <div className="mb" style={{ maxHeight: '64vh', overflow: 'auto' }}>
        <p className="dim" style={{ marginBottom: 10 }}>
          {acted.length ? `${acted.length} acting this round — ${(['mitigation', 'relief', 'resilience'] as const).filter((p) => tally(p) > 0).map((p) => `${tally(p)} ${p}`).join(', ')}.` : 'Nobody else is acting this round.'}
          {' '}{held.length > 0 && `${held.length} holding${heldForStanding.length ? ` (${heldForStanding.length} protecting their own standing)` : ''}.`}
        </p>
        {records.map((r) => (
          <div key={r.portfolio} className="cab-row">
            <div className="cab-head">
              <b>{SEAT_NAME[r.portfolio]}</b>
              <span className="dim">{r.health.toFixed(1)}/10 · {r.doctrine}</span>
            </div>
            {r.move ? (
              <div className="cab-move">
                <span className="cab-badge" style={{ color: `var(--${r.move.priority === 'mitigation' ? 'cyan' : r.move.priority === 'relief' ? 'amber' : 'green'})` }}>
                  {PRIORITY_LABEL[r.move.priority]}
                </span>
                <span className="cab-policy">{r.move.policyName} ({r.move.severity})</span>
                <span className="dim">lags {r.move.lag} → lands round {r.move.landsRound}{r.move.landsRound > 12 ? ' (too late)' : ''}</span>
                {r.refused && <span className="warn cab-refused">refused the deeper cut it wanted</span>}
              </div>
            ) : (
              <div className="cab-move">
                <span className="cab-badge cab-hold">HOLDING</span>
                <span className="dim">
                  {r.holdReason === 'protecting-standing' ? 'protecting political standing this round' : 'nothing on the table was worth the cost'}
                </span>
              </div>
            )}
            <p className="cab-decl">"{r.declaration}"</p>
          </div>
        ))}
        <div className="committray">
          <div className="dim">Every commitment is in.</div>
          <button className="act" onClick={onNext}>SEE HOW IT LANDS ▸</button>
        </div>
      </div>
    </>
  )
}

function Options({ session, s, advisors, selected, setSelected, onCommit }: {
  session: Session; s: Snap; advisors: import('./session.ts').Advisor[]; selected: Committed[]; setSelected: (f: (x: Committed[]) => Committed[]) => void; onCommit: () => void
}) {
  const menu = session.menu(selected)
  const remaining = s.you.budget - selected.reduce((a, m) => a + (menu.find((x) => x.policyId === m.policyId && x.severity === m.severity)?.cost ?? 0), 0)
  const remove = (i: number) => setSelected((x) => x.filter((_, j) => j !== i))
  const toggle = (t: MenuTier) => {
    if (t.disabled && !t.selected) return
    if (t.selected) setSelected((x) => x.filter((sel) => !(sel.policyId === t.policyId && sel.severity === t.severity)))
    else setSelected((x) => [...x, { policyId: t.policyId, severity: t.severity, by: s.seat }])
  }
  const groups: { id: string; name: string; summary: string; tiers: typeof menu }[] = []
  for (const t of menu) { let g = groups.find((x) => x.id === t.policyId); if (!g) { g = { id: t.policyId, name: t.policyName, summary: t.summary, tiers: [] }; groups.push(g) } g.tiers.push(t) }
  const allDisabled = menu.every((t) => t.disabled)

  return (
    <>
      <Header tag={`ROUND ${s.round} · YOUR MOVE`} title={SEAT_NAME[s.seat].toUpperCase()} sub={`health ${s.you.health.toFixed(1)}/10 · ${remaining}/${s.you.budget} points · ${s.you.doctrine}`} />
      <div className="mb" style={{ maxHeight: '62vh', overflow: 'auto' }}>
        <div className="advisors">
          {advisors.map((a, i) => (
            <div key={i} className="advisor">
              <div className="advisor-h"><b>{a.name}</b><span>{a.role}</span></div>
              {a.lines.map((line, j) => <p key={j}>{line}</p>)}
            </div>
          ))}
        </div>
        {s.you.restrictions.length > 0 && <div className="hot" style={{ fontSize: 11 }}>🔒 locked out of: {s.you.restrictions.map((r) => r.forbidsFlag).join(', ')}</div>}
        <hr className="rule" />
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
    </>
  )
}

function Resolution({ s, onNext, last }: { s: Snap; onNext: () => void; last: boolean }) {
  const c = s.lastConsequence!
  return (
    <>
      <Header tag={`ROUND ${c.round} RESOLVES · ${c.year}`} title="YOUR POLICIES LAND" sub="" />
      <div className="mb">
        <div className="dim" style={{ letterSpacing: 2, fontSize: 10 }}>AROUND THE CABINET —</div>
        {c.playerMoves.length > 0
          ? <p>You committed <b>{c.playerMoves.map((m) => `${m.name} (${m.severity})`).join(', ')}</b>.</p>
          : <p className="dim">You held — a round spent recovering.</p>}
        {c.cabinetMoves.length > 0
          ? <p className="dim">{c.cabinetMoves.map((m) => `${SEAT_NAME[m.seat].split(' ')[0]}: ${m.name} (${m.severity})`).join(' · ')}</p>
          : <p className="dim">The rest of the cabinet held.</p>}
        {c.spilled.length > 0 && (
          <p className="warn">Your policies landed on your colleagues: {c.spilled.map((x) => `${SEAT_NAME[x.seat].split(' ')[0]} ${x.amount > 0 ? `−${x.amount}` : `+${-x.amount}`}`).join(', ')} health.</p>
        )}
        {c.successions.map((sx, i) => (
          <p key={i} className="hot">↳ {SEAT_NAME[sx.portfolio]} fell ({sx.cause}) → a {sx.archetype} takes the seat.{sx.byPlayer && <span> Your policy toppled them; it is written in your ledger.</span>}</p>
        ))}

        <hr className="rule" />
        <div className="dim" style={{ letterSpacing: 2, fontSize: 10 }}>THE WORLD ABSORBS IT —</div>
        <p><span className="hot toll" style={{ fontSize: 16 }}>{c.total.toFixed(0)} million died this round.</span></p>
        <div className="chanrow" style={{ marginBottom: 8 }}>
          {CH.map((ch) => <span key={ch}>{ch} <b>{c.byChannel[ch].toFixed(0)}</b></span>)}
        </div>
        <p>The counter climbs to <b className="hot">{bn(c.cumulative)} billion</b>.</p>

        <div className="committray">
          <div className="dim">{last ? 'The mandate is over. Four years pass...' : 'The next round assembles.'}</div>
          <button className="act" onClick={onNext}>{last ? 'READ THE FINAL REPORT ▸' : 'NEXT ROUND ▸'}</button>
        </div>
      </div>
    </>
  )
}
