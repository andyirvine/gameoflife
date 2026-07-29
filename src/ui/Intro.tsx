import { useState } from 'react'
import { PORTFOLIOS, SEAT_NAME, SEAT_WEAKNESS } from './session.ts'
import type { PortfolioId } from '../engine/types.ts'

export function Intro({ onStart }: { onStart: (seat: PortfolioId, seed: number) => void }) {
  const [seat, setSeat] = useState<PortfolioId | ''>('')
  const [seed] = useState(() => Math.floor(Math.random() * 1e6))
  const [view, setView] = useState<'briefing' | 'howto'>('briefing')

  return (
    <div className="modal-scrim">
      <div className="modal">
        <div className="mh">
          <div className="t">MINISTERS</div>
          <div className="s">A cabinet of the Climate Union · a twenty-year mandate · a planet already 1.3°C too warm</div>
          <div className="introtabs">
            <button className={view === 'briefing' ? 'on' : ''} onClick={() => setView('briefing')}>THE BRIEFING</button>
            <button className={view === 'howto' ? 'on' : ''} onClick={() => setView('howto')}>HOW TO PLAY</button>
          </div>
        </div>

        {view === 'briefing' ? (
          <div className="mb">
            <p className="lead">
              You are one seat in the cabinet of the <b>Climate Union</b> — the EU and the willing,
              a coalition of roughly 30% of global emissions. 
            </p>
            <p className="dim">
              
            </p>
            <hr className="rule" />
            <div className="dim" style={{ marginBottom: 6 }}>Choose your position in the cabinet</div>
            <div className="seatpick">
              {PORTFOLIOS.map((p) => (
                <div key={p} className={`seat${seat === p ? ' on' : ''}`} onClick={() => setSeat(p)}>
                  <b>{SEAT_NAME[p]}</b>
                  <span>{SEAT_WEAKNESS[p]}</span>
                </div>
              ))}
            </div>
            <div className="committray">
              <div className="dim">
                World seed {seed} · 12 rounds of two years · assessed four years on, in 2054
                {!seat && <span className="warn"> · pick a seat above to convene</span>}
              </div>
              <button className="act" disabled={!seat} onClick={() => seat && onStart(seat, seed)}>CONVENE CABINET ▸</button>
            </div>
          </div>
        ) : (
          <div className="mb howto">
            <div className="ht-lead">Your mission is to prevent as many deaths as possible.</div>

            <div className="ht-h">EACH ROUND PLAYS IN FOUR BEATS, twelve times over:</div>
            <ol>
              <li><b>The situation</b> — your advisors diagnose where the world stands.</li>
              <li><b>The world moves</b> — two decks act before you: politics (the World deck) and physical shocks (the Events deck, likelier the hotter it gets). You get no say.</li>
              <li><b>Your move</b> — you spend your points on policies. This is your only lever.</li>
              <li><b>The reckoning</b> — what the whole cabinet did, who your choices cost, and how many died.</li>
            </ol>

            <div className="ht-h">THE RULES THAT MATTER:</div>
            <ul>
              <li><b className="c1">One counter.</b> Cumulative excess deaths, global, only ever rising. You cannot stop it — only bend the slope. The ghost figure beside it shows what a do-nothing cabinet would reach.</li>
              <li><b className="c1">Health is power.</b> Your political standing (0–10) sets how many points you get to spend each round. Bold policies cost more points, so a weakened minister simply <i>cannot</i> make big moves. Hit zero and you are not eliminated — you are <b>replaced</b> by a successor shaped by how you fell, often locked out of the very lever that felled you.</li>
              <li><b className="c1">Lag.</b> You pay a policy's political cost <i>now</i>; its planetary payoff lands one to six rounds <i>later</i> — often after you have left office. Start the slow levers early, or they arrive too late to count.</li>
              <li><b className="c1">You govern 30%.</b> Your domestic policies cut your own coalition's emissions. The free-riding 70% of the world bends only to <b>diplomacy</b> — border carbon, coalition deals, tech transfer. You cannot hit the climate targets alone.</li>
              <li><b className="c1">Spillover.</b> Your policies cost your colleagues health too. Lean too hard and you topple one of them — and the fall is written, by name, in your ledger.</li>
              <li><b className="c1">The forecast.</b> Your private model foregrounds one risk — food, feedbacks, heat, displacement. All six ministers' models are sound; they simply disagree on what to fear most. It is advice, not gospel.</li>
              <li><b className="c1">The targets.</b> Nine planetary goals, judged four years after your mandate ends. Hit most for a "survivable" ending. None of them are good.</li>
            </ul>

            <div className="committray">
              <div className="dim">Ready?</div>
              <button className="act" onClick={() => setView('briefing')}>◂ BACK TO THE BRIEFING</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
