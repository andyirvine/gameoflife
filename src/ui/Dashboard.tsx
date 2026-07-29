import { Session, SEAT_NAME } from './session.ts'

type Snap = ReturnType<Session['snapshot']>

// The stats now flank the central theatre. `side` selects which panels sit on the left
// (the world) versus the right (the room + the future + your seat).
export function Dashboard({ session, side }: { session: Session; side: 'left' | 'right' }) {
  const s = session.snapshot()
  return (
    <div className="col">
      {side === 'left' ? (
        <>
          <PlanetPanel s={s} />
          <TargetsPanel s={s} />
        </>
      ) : (
        <>
          <ForecastPanel s={s} />
          <CabinetPanel s={s} />
          <PipelinePanel s={s} />
          <LedgerPanel s={s} />
        </>
      )}
    </div>
  )
}

function PlanetPanel({ s }: { s: Snap }) {
  return (
    <div className="panel">
      <h3><span>PLANET · {s.year}</span><span>peak {s.peakTemp.toFixed(2)}°C</span></h3>
      <div className="body">
        <dl className="readout">
          <dt>temp anomaly</dt><dd className={s.planet.tempAnomaly > 1.6 ? 'hot' : 'warn'}>{s.planet.tempAnomaly.toFixed(2)} °C</dd>
          <dt>CO₂</dt><dd>{s.planet.co2.toFixed(0)} ppm</dd>
          <dt>global emissions</dt><dd>{s.planet.annualEmissions.toFixed(1)} Gt</dd>
        </dl>
        <div className="split">
          <div className="bar">
            <i className="coalition" style={{ width: `${(s.planet.coalitionEmissions / s.planet.annualEmissions) * 100}%` }} />
            <i className="nonmember" style={{ width: `${(s.planet.nonMemberEmissions / s.planet.annualEmissions) * 100}%` }} />
          </div>
        </div>
        <div className="dim" style={{ fontSize: 10, marginBottom: 6 }}>
          <span className="ok">■</span> coalition {s.planet.coalitionEmissions.toFixed(1)} &nbsp; <span className="warn">▨</span> non-member {s.planet.nonMemberEmissions.toFixed(1)} (free-riding)
        </div>
        <dl className="readout">
          <dt>methane</dt><dd>{s.planet.methane.toFixed(0)} ppb</dd>
          <dt>food-insecure</dt><dd className={s.planet.foodInsecure > 600 ? 'hot' : 'ok'}>{s.planet.foodInsecure.toFixed(0)} M</dd>
          <dt>displaced / unresettled</dt><dd>{s.planet.displacedAnnual.toFixed(0)} · {s.planet.displacedUnresettled.toFixed(0)} M</dd>
          <dt>forest loss</dt><dd>{s.planet.forestLossRate.toFixed(1)} Mha/yr</dd>
          <dt>climate damages</dt><dd>{s.planet.damagesPctGdp.toFixed(1)} % GDP</dd>
        </dl>
      </div>
    </div>
  )
}

function TargetsPanel({ s }: { s: Snap }) {
  return (
    <div className="panel">
      <h3><span>PLANETARY TARGETS</span><span>{s.targets.filter((t) => t.hit).length}/9 · assessed 2054</span></h3>
      <div className="body">
        <div className="targets">
          {s.targets.map((t) => (
            <div key={t.name} className={`t ${t.hit ? 'hit' : 'miss'}`}>
              <span className="mark">{t.hit ? '✓' : '✗'}</span>
              <span className="name">{t.name}</span>
              <span className="val">{t.actual}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function CabinetPanel({ s }: { s: Snap }) {
  return (
    <div className="panel">
      <h3><span>THE CABINET</span><span>spillover lands here</span></h3>
      <div className="body">
        {s.cabinet.map((m) => (
          <div key={m.portfolio} className="minister">
            <span className="nm">{SEAT_NAME[m.portfolio].split(' ')[0]}</span>
            <span className={`hbar h-${m.band.toLowerCase()}`}><i style={{ width: `${m.health * 10}%` }} /></span>
            <span className="num">
              {m.health.toFixed(1)} {m.gen > 1 && <span className="dim">g{m.gen}</span>}
              {m.health < 3 && <span className="risk"> ⚠</span>}
              {m.restriction && <span className="dim"> 🔒</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ForecastPanel({ s }: { s: Snap }) {
  return (
    <div className="panel forecast">
      <h3><span>YOUR FORECAST · {s.forecast.name}</span><span>conf {(s.forecast.confidence * 100).toFixed(0)}%</span></h3>
      <div className="body">
        <div className="creed">"{s.forecast.creed}"</div>
        <div className="head">{s.forecast.headline}</div>
        <table><tbody>
          {s.forecast.checkpoints.map((c) => (
            <tr key={c.year}><td>{c.year}</td><td>{c.temp.toFixed(2)}±{s.forecast.band.toFixed(2)}°C</td><td>food {Math.round(c.foodInsecure)}M</td><td>unset {Math.round(c.unresettled)}M</td></tr>
          ))}
        </tbody></table>
        <div className="dim" style={{ marginTop: 4, fontSize: 10 }}>
          feedback watch: {s.forecast.feedbackWatch.map((f) => `${f.name} ${(f.oddsNow * 100).toFixed(0)}→${(f.oddsEnd * 100).toFixed(0)}%`).join(' · ')}
        </div>
      </div>
    </div>
  )
}

function PipelinePanel({ s }: { s: Snap }) {
  return (
    <div className="panel">
      <h3><span>IN FLIGHT · pipeline</span><span>{s.pipeline.length} pending</span></h3>
      <div className="body">
        {s.pipeline.length === 0 && <div className="dim">nothing pending — every enacted policy has landed.</div>}
        <div className="pipe">
          {s.pipeline.slice(0, 10).map((e, i) => (
            <div key={i} style={{ display: 'contents' }}>
              <span className={e.eta === 'too late' ? 'toolate' : 'when'}>R{e.landsRound} ({e.eta})</span>
              <span className={e.mine ? 'mine' : 'theirs'}>{e.policyName} ({e.severity})</span>
              <span className="dim">{e.mine ? 'you' : SEAT_NAME[e.by].split(' ')[0]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}


function LedgerPanel({ s }: { s: Snap }) {
  return (
    <div className="panel">
      <h3><span>THE LEDGER OF WHAT YOU TRADED</span></h3>
      <div className="body led" style={{ maxHeight: 220, overflow: 'auto' }}>
        {s.tradeLedger.length === 0 && <div className="dim">— nothing traded yet —</div>}
        {s.tradeLedger.map((l, i) => (
          <div key={i} style={{ padding: '2px 0', borderTop: i ? '1px dashed var(--line)' : 'none' }}>{l}</div>
        ))}
      </div>
    </div>
  )
}
