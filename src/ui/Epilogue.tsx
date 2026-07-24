import { Session, SEAT_NAME } from './session.ts'

const bn = (m: number) => (m / 1000).toFixed(2)

export function Epilogue({ data, onRestart }: { data: ReturnType<Session['epilogue']>; onRestart: () => void }) {
  const d = data
  const verdict = d.targetsHit >= 6 ? 'A survivable ending. It is not a good one, and the counter still rose.'
    : d.targetsHit >= 3 ? 'Not survivable on the targets that mattered. The gap to the best available line was real, and you did not close it.'
    : 'A runaway. Most of what could be lost was lost.'

  const character = d.did.roundsHeld > d.did.roundsActed ? 'a cautious ministry — you held more than you spent'
    : d.did.emissions / 40 + d.did.methane / 1000 >= d.did.relief / 300 ? 'a mitigation ministry — you spent yourself buying time off the atmosphere'
    : 'a relief ministry — you spent yourself keeping people fed'

  return (
    <div className="modal-scrim">
      <div className="modal">
        <div className="mh">
          <div className="t">{d.year} · WORLD STATE REPORT</div>
          <div className="s">Four years after your mandate ended. Your final decisions have landed.</div>
        </div>
        <div className="mb">
          <p className="lead">
            Emissions at {d.planet.annualEmissions.toFixed(0)} GtCO₂e. Temperature peaked at {d.peakTemp.toFixed(2)}°C
            and is {d.falling ? 'now falling' : 'still rising'}. Forest loss {d.planet.forestLossRate <= 0.5 ? 'halted' : `running at ${d.planet.forestLossRate.toFixed(0)} Mha/yr`}.
          </p>
          <p>
            <span className="hot" style={{ fontSize: 16 }}>Cumulative excess deaths, 2026–{d.year}: {bn(d.counter)} billion.</span><br />
            <span className="dim">Displaced and not resettled: {Math.round(d.planet.displacedUnresettled)} million · {d.falls} ministers fell.</span>
          </p>

          <div className="epi-targets">
            {d.targets.map((t) => (
              <div key={t.name} className={`t ${t.hit ? 'hit' : 'miss'}`}>
                <span className="mark">{t.hit ? '✓' : '✗'}</span> {t.name} <span className="val">{t.actual}</span>
              </div>
            ))}
          </div>
          <div className="dim">Planetary targets met: {d.targetsHit} of 9.</div>

          <hr className="rule" />
          <div className="dim" style={{ letterSpacing: 2, fontSize: 10 }}>THE RECKONING</div>
          <p>History will record {character}. You bought {d.did.emissions.toFixed(0)} GtCO₂e of cuts and {d.did.methane.toFixed(0)} ppb of methane off the future,
            delivered {d.did.relief.toFixed(0)}M of food relief, laid down {d.did.resilience.toFixed(0)} points of resilience — at a cost of {d.did.healthSpent} of your own standing
            {d.did.toppled > 0 && <span> and {d.did.toppled} colleague{d.did.toppled > 1 ? 's' : ''} who paid for your trades with their careers</span>}.
            The channel that did the most killing was <b>{d.dominant}</b>.
          </p>

          {d.preventable && (
            <p className="led">
              You accepted a <b>{d.preventable.channel}</b> crisis you had the resources to prevent in Round {d.preventable.round} ({d.preventable.year}):
              {' '}{d.preventable.policy} would have cost {d.preventable.points} points and cut ~{d.preventable.avoided}M deaths that round.
              The cabinet left <span className="cost">{d.preventable.unspent} points unspent</span>.
            </p>
          )}

          <p className="dim">
            What comes next, because the pipeline outlives you — on the trajectory you leave, by {d.future.year}: ~{d.future.temp.toFixed(2)}°C
            {d.falling ? ', the peak behind you' : ', still climbing'}, ~{Math.round(d.future.food)}M food-insecure, ~{Math.round(d.future.unresettled)}M still displaced.
          </p>

          <hr className="rule" />
          <p className="led">
            Of the six forecasts, the one that read this game closest was {SEAT_NAME[d.vindSeat]}'s — "{d.vindName}", which foregrounded {d.vindEmphasis},
            and {d.vindEmphasis} is what did the most killing. {d.vindFell ? 'That office fell; its warning was on the table the whole time.' : 'They held their seat the whole mandate.'}
            {d.vindIsYou && <span className="hot"> The lens that mattered was the one in your own files.</span>}
          </p>

          <div className="mono-block" style={{ marginTop: 10 }}>
            <div className="dim" style={{ letterSpacing: 2, fontSize: 10 }}>THE SLOPE</div>
            Had the cabinet done nothing, the counter reaches {bn(d.shadow)} bn.
            You bent it to {bn(d.counter)} bn — {bn(d.shadow - d.counter)} bn fewer dead than doing nothing.
            You could not stop it. Nobody could. All you could do was change the slope.
          </div>

          <div className="verdict">{verdict}</div>

          <div className="committray">
            <div className="dim">You did not play to ensure survival. You played to decide what kind of survival, and how much of it you were willing to prevent — and didn't.</div>
            <button className="act" onClick={onRestart}>NEW MANDATE ▸</button>
          </div>
        </div>
      </div>
    </div>
  )
}
