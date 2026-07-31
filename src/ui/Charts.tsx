// Minimal hand-rolled SVG line charts for the forecast panel — no charting library, kept
// consistent with the rest of the dashboard's custom bars/meters. Each chart plots history
// (solid) joined seamlessly to a forward projection (dashed) at the current round, with a
// "NOW" marker at the join.

export type SeriesPoint = { round: number; year: number; value: number }
export type Series = {
  label: string
  color: string
  history: SeriesPoint[]
  projection: SeriesPoint[]
  format: (v: number) => string
  zeroBaseline?: boolean   // force the y-axis floor to 0 (for monotonic totals like deaths)
}

const W = 100  // SVG viewBox units — scales to container via CSS
const H = 46
const PAD_L = 2
const PAD_R = 2
const PAD_T = 4
const PAD_B = 4

function scaleFns(allRounds: number[], allValues: number[], zeroBaseline: boolean) {
  const xMin = Math.min(...allRounds)
  const xMax = Math.max(...allRounds)
  let yMin = Math.min(...allValues)
  let yMax = Math.max(...allValues)
  if (zeroBaseline) yMin = Math.min(0, yMin)
  if (yMax === yMin) yMax = yMin + 1
  const pad = (yMax - yMin) * 0.08
  yMin -= pad
  yMax += pad
  const x = (r: number) => PAD_L + ((r - xMin) / Math.max(1, xMax - xMin)) * (W - PAD_L - PAD_R)
  const y = (v: number) => H - PAD_B - ((v - yMin) / (yMax - yMin)) * (H - PAD_T - PAD_B)
  return { x, y, xMin, xMax, yMin, yMax }
}

function pathD(points: SeriesPoint[], x: (r: number) => number, y: (v: number) => number): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.round).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ')
}

// One chart, one or two series sharing an x-axis (round). Each series is scaled to its own
// y-range when `perSeriesScale` is set (for plotting metrics of very different magnitude on
// the same chart, e.g. deaths in billions alongside displacement in millions).
export function TrajectoryChart({
  title, series, nowRound, perSeriesScale, thresholds,
}: {
  title: string
  series: Series[]
  nowRound: number
  perSeriesScale?: boolean
  thresholds?: { value: number; label: string; color: string }[]
}) {
  const allRounds = series.flatMap((s) => [...s.history, ...s.projection]).map((p) => p.round)
  // Shared x-scale always; y-scale either shared (single metric) or per-series (dual metric).
  const sharedValues = series.flatMap((s) => [...s.history, ...s.projection].map((p) => p.value))
  const shared = scaleFns(allRounds, sharedValues, series.some((s) => s.zeroBaseline))
  const scalesBySeries = series.map((s) =>
    perSeriesScale
      ? scaleFns(allRounds, [...s.history, ...s.projection].map((p) => p.value), !!s.zeroBaseline)
      : shared,
  )
  const nowX = shared.x(nowRound)

  return (
    <div className="chart">
      <div className="chart-title">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="chart-svg">
        {/* baseline + now-marker */}
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} className="chart-axis" />
        <line x1={nowX} y1={PAD_T} x2={nowX} y2={H - PAD_B} className="chart-now" />
        {thresholds?.map((t, i) => {
          const sc = scalesBySeries[0]!
          const ty = sc.y(t.value)
          return <line key={i} x1={PAD_L} y1={ty} x2={W - PAD_R} y2={ty} className="chart-threshold" style={{ stroke: t.color }} />
        })}
        {series.map((s, i) => {
          const sc = scalesBySeries[i]!
          const joined = s.history.length ? [s.history[s.history.length - 1]!, ...s.projection] : s.projection
          return (
            <g key={s.label}>
              <path d={pathD(s.history, sc.x, sc.y)} fill="none" stroke={s.color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
              <path d={pathD(joined, sc.x, sc.y)} fill="none" stroke={s.color} strokeWidth={1.4} strokeDasharray="2.5,2" vectorEffect="non-scaling-stroke" opacity={0.75} />
            </g>
          )
        })}
      </svg>
      <div className="chart-legend">
        {series.map((s, i) => {
          const last = s.history[s.history.length - 1]
          const end = s.projection[s.projection.length - 1] ?? last
          return (
            <div key={s.label} className="chart-legend-row">
              <span className="chart-swatch" style={{ background: s.color }} />
              <span className="chart-legend-label">{s.label}</span>
              <span className="chart-legend-val">now {last ? s.format(last.value) : '—'}</span>
              <span className="chart-legend-val dim">→ {end ? s.format(end.value) : '—'} by {end?.year ?? ''}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
