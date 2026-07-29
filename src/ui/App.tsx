import { useState } from 'react'
import { Session, type PORTFOLIOS } from './session.ts'
import { Intro } from './Intro.tsx'
import { Dashboard } from './Dashboard.tsx'
import { Theatre } from './Theatre.tsx'
import { Epilogue } from './Epilogue.tsx'
import type { PortfolioId } from '../engine/types.ts'

type Screen = 'intro' | 'play' | 'epilogue'

export function App() {
  const [screen, setScreen] = useState<Screen>('intro')
  const [session, setSession] = useState<Session | null>(null)
  const [, setTick] = useState(0)
  const bump = () => setTick((t) => t + 1)

  const start = (seat: PortfolioId, seed: number) => {
    setSession(new Session(seed, seat))
    setScreen('play')
  }

  // Commit mutates the session; the Theatre handles the transition to the epilogue itself
  // (via its resolution stage), so we don't switch screens here.
  const onCommit = (moves: Parameters<Session['commit']>[0]) => {
    if (!session) return
    session.commit(moves)
    bump()
  }

  const s = session?.snapshot()
  const bn = (m: number) => (m / 1000).toFixed(2)

  return (
    <div className="terminal">
      <div className="topbar">
        <div className="brand">GAME OF LIFE<small>CLIMATE UNION · CABINET TERMINAL v0.9</small></div>
        <div className="tag">{session ? `seat: ${session.seat.toUpperCase()} · seed ${session.seed}` : 'not yet convened'}</div>
      </div>

      {/* the counter spans the top — always in your peripheral vision */}
      {s && (
        <div className="counter">
          <div>
            <div className="lbl">Cumulative excess deaths · climate impacts · global</div>
            <div className="big" key={s.counter}>{bn(s.counter)} bn</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="lbl">Round</div>
            <div style={{ fontSize: 22, color: 'var(--green)' }}>{s.round}<span className="dim" style={{ fontSize: 13 }}>/12</span></div>
            <div className="dim">{s.year} · {12 - s.round} left</div>
          </div>
        </div>
      )}

      {/* the theatre holds centre stage; the dashboard flanks it left and right */}
      {session && (
        <div className="stage">
          <div className="stage-side">
            <Dashboard session={session} side="left" />
          </div>

          <div className="stage-center">
            {screen === 'play' && (
              <Theatre session={session} onCommit={onCommit} onEpilogue={() => setScreen('epilogue')} />
            )}
          </div>

          <div className="stage-side">
            <Dashboard session={session} side="right" />
          </div>
        </div>
      )}

      {screen === 'intro' && <Intro onStart={start} />}
      {screen === 'epilogue' && session && <Epilogue data={session.epilogue()} onRestart={() => { setSession(null); setScreen('intro') }} />}
    </div>
  )
}

export type { PORTFOLIOS }
