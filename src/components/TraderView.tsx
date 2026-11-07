import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useStepUp } from '../lib/useStepUp'
import { pct, shortDate, signedPct, signedWon, signedWonExact, won, wonShort } from '../lib/format'
import type { TraderBuy, TraderDay, TraderSummary } from '../types'
import StepUpBar from './StepUpBar'
import { SignedBars, Spark, spanDomain } from './Charts'
import { Empty } from './Ui'

const MASK = '••••••'
const VERDICT = { clear: 'All clear', attention: 'Needs a look', bad: 'Problem' } as const

// The weekly buys as two rows of bars, oldest week on the left: what each week's buy is worth now, and how that
// compares with the same money in the S&P 500 ETF. Same numbers as the table under it.
function WeeklyBars({ rows }: { rows: TraderBuy[] }) {
  const [at, setAt] = useState<number | null>(null)
  const weeks = useMemo(() => [...rows].reverse(), [rows])
  if (weeks.length === 0) return null
  const w = at != null ? weeks[at] : undefined // the data can shrink under a stale index
  const last = weeks[weeks.length - 1]
  const shown = w ?? last
  return (
    <div className="tr-bars">
      <div className="tr-bars-head">
        <span>Return per week</span>
        <span className="tr-bars-read">{shown.period} · {signedPct(shown.ret)} · {signedPct(shown.ret - shown.bench)} vs S&amp;P</span>
      </div>
      <SignedBars values={weeks.map(b => b.ret)} onActive={setAt} label="Return of each weekly buy" className="tr-sbars" />
      <div className="tr-bars-head"><span>Against the S&amp;P 500 ETF</span></div>
      <SignedBars values={weeks.map(b => b.ret - b.bench)} onActive={setAt} label="Return of each weekly buy minus the S&P 500 ETF" className="tr-sbars" />
      <div className="tr-chart-axis"><span>{weeks[0].period}</span><span>bar up: ahead, bar down: behind · hover for a week</span><span>{last.period}</span></div>
    </div>
  )
}

// The day trader's results, oldest day on the left: the estimated net of each day, and the running total under it.
function DayTradeBars({ all }: { all: TraderDay[] }) {
  const [at, setAt] = useState<number | null>(null)
  const days = useMemo(() => all.slice(-30), [all]) // the last 30 days
  const cum = useMemo(() => days.reduce<number[]>((a, d) => [...a, (a[a.length - 1] ?? 0) + d.net], []), [days])
  if (days.length === 0) return <p className="tr-muted">No day-trade day has finished yet.</p>
  const d = at != null ? days[at] : undefined // the data can shrink under a stale index
  const entries = days.reduce((t, x) => t + x.entries, 0)
  return (
    <div className="tr-bars">
      <div className="tr-bars-head">
        <span>Net per day (est.)</span>
        <span className="tr-bars-read">
          {d ? `${shortDate(d.date)} · ${d.entries} ${d.entries === 1 ? 'entry' : 'entries'} · ${signedWonExact(d.net)}` : `${days.length} days · ${entries} entries · ${signedWonExact(cum[cum.length - 1])}`}
        </span>
      </div>
      <SignedBars values={days.map(x => x.net)} onActive={setAt} label="Estimated day-trade result of each day" className="tr-sbars tr-sbars-tall" />
      <div className="tr-bars-head"><span>Running total</span></div>
      <div className="tr-chart tr-chart-short"><Spark points={cum} base={0} fill label="Running total of the day-trade results" /></div>
      <div className="tr-chart-axis"><span>{shortDate(days[0].date)}</span><span>dashed: zero</span><span>{shortDate(days[days.length - 1].date)}</span></div>
    </div>
  )
}

// Trader (the weekly ETF buys and the day-trade experiment): the summary of what the admin Trader tab shows,
// behind the same passkey step-up as Assets and Health. Read-only: orders, switches and the plumbing stay in admin.
export default function TraderView({ isAuth }: { isAuth: boolean }) {
  const [masked, setMasked] = useState(false)
  const [data, setData] = useState<TraderSummary | null>(null)
  // A request that returns after a lock must not put data back: every lock moves the generation on.
  const gen = useRef(0)
  const clearData = useCallback(() => { gen.current++; setMasked(false); setData(null) }, [])
  const { unlocked, busy, setBusy, error, setError, remaining, lock, unlock, handleError } = useStepUp('trader', isAuth, clearData)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    const g = gen.current
    try {
      const d = await api.trader.getSummary()
      if (g === gen.current) setData(d)
    } catch (err) {
      if (g === gen.current) handleError(err)
    } finally {
      setBusy(false)
    }
  }, [handleError, setBusy, setError])
  useEffect(() => { if (unlocked) load() }, [unlocked, load])

  const hide = masked || !data
  const amt = (n: number | undefined, f: (n: number) => string = won) => (hide || n === undefined ? MASK : f(n))
  const etfs = useMemo(() => [...(data?.etfs ?? [])].sort((a, b) => b.value - a.value), [data])

  if (!unlocked) {
    return (
      <div className="assets-view">
        {error && <p className="assets-error">{error}</p>}
        <Empty icon="lock" title="Trader is locked" hint="Verify with your passkey to see the portfolio and the weekly buys. Everything stays hidden until then." action={{ label: 'Show with passkey', onClick: unlock, disabled: busy }} />
      </div>
    )
  }

  const t = data?.trader
  const hist = data?.portfolio.history ?? []
  // One scale for value and cost, at least ±2% wide so a small move does not look like a crash.
  const [lo, hi] = hist.length ? spanDomain(hist.flatMap(h => [h[1], h[2]])) : [0, 0]
  const change = hist.length > 1 && hist[0][1] ? hist[hist.length - 1][1] / hist[0][1] - 1 : null

  return (
    <div className="assets-view tr-view">
      <StepUpBar unlocked={unlocked} busy={busy} remaining={remaining} masked={masked} onToggleMask={() => setMasked(m => !m)} onUnlock={unlock} onLock={lock} />
      {error && <p className="assets-error">{error}</p>}

      <div className="assets-stat-grid">
        <div className="assets-stat assets-stat-primary">
          <span className="assets-stat-label">Total value{data ? ` · ${data.env === 'real' ? 'Real' : 'Paper'} account` : ''}</span>
          <span className="assets-stat-value">{amt(t?.total_value)}</span>
        </div>
        <div className="assets-stat">
          <span className="assets-stat-label">Gain on the ETFs</span>
          <span className="assets-stat-value">{hide || !t ? MASK : `${signedWon(t.gain)} (${signedPct(t.gain_pct)})`}</span>
        </div>
        <div className="assets-stat">
          <span className="assets-stat-label">Cash</span>
          <span className="assets-stat-value">{amt(t?.cash)}</span>
        </div>
        <div className="assets-stat">
          <span className="assets-stat-label">Invested</span>
          <span className="assets-stat-value">{amt(t?.invested)}</span>
        </div>
        <div className="assets-stat">
          <span className="assets-stat-label">Day trade, net</span>
          <span className="assets-stat-value">{hide || !t ? MASK : signedWonExact(t.daytrade_net)}</span>
        </div>
      </div>

      {data && (
        <p className="tr-verdict">
          <span className={`tr-dot tr-dot-${data.verdict.level}`} />
          <span className="tr-verdict-label">{VERDICT[data.verdict.level]}</span>
          <span className="tr-muted"> · {data.checks.filter(c => c.status === 'ok').length} of {data.checks.length} checks ok{t?.as_of ? ` · account as of ${shortDate(t.as_of.slice(0, 10))}` : ''}</span>
        </p>
      )}

      <section className="assets-section tr-wide">
        <div className="section-label">Portfolio value</div>
        {hist.length > 1 && !masked ? (
          <>
            <div className="tr-chart">
              <Spark points={hist.map(h => h[2])} min={lo} max={hi} className="tr-chart-cost" />
              <Spark points={hist.map(h => h[1])} min={lo} max={hi} fill label="Portfolio value over time" />
              <span className="tr-axis tr-axis-hi">{wonShort(hi)}</span>
              <span className="tr-axis tr-axis-lo">{wonShort(lo)}</span>
            </div>
            <div className="tr-chart-axis">
              <span>{shortDate(hist[0][0])}</span>
              <span>solid: value{change != null ? ` (${signedPct(change)} since ${shortDate(hist[0][0])})` : ''} · dashed: cost ({data ? wonShort(data.portfolio.cost) : ''}) · min ±2% scale</span>
              <span>{shortDate(hist[hist.length - 1][0])}</span>
            </div>
          </>
        ) : <p className="tr-muted">{masked ? MASK : 'No history yet.'}</p>}
      </section>

      <section className="assets-section tr-wide">
        <div className="section-label">Holdings</div>
        <div className="tr-table" role="table">
          <div className="tr-row tr-head" role="row">
            <span>ETF</span><span className="tr-num">Value</span><span className="tr-num">Gain</span><span>Share / target</span><span>Trend</span>
          </div>
          {etfs.map(e => (
            <div key={e.code} className="tr-row" role="row">
              <span className="tr-name"><b>{e.name}</b><i>{e.code} · {hide ? MASK : `${e.qty.toLocaleString('en-US')} @ ${won(e.avg)}`}</i></span>
              <span className="tr-num">{amt(e.value, wonShort)}</span>
              <span className="tr-num">{hide ? MASK : signedPct(e.gain_pct)}</span>
              <span className="tr-share">
                {hide ? <i>{MASK}</i> : (
                  <>
                    <span className="tr-share-track"><span style={{ width: `${Math.min(e.share * 100, 100)}%` }} /><em style={{ left: `${Math.min(e.target * 100, 100)}%` }} /></span>
                    <i>{pct(e.share)} / {pct(e.target, 0)}</i>
                  </>
                )}
              </span>
              <span className="tr-trend">{!hide && <Spark points={e.series.map(s => s[1])} />}</span>
            </div>
          ))}
          {etfs.length === 0 && <p className="tr-muted">No holdings yet.</p>}
        </div>
      </section>

      <section className="assets-section tr-wide">
        <div className="section-label">Weekly buys</div>
        {data && !data.buys.enough && <p className="tr-muted">{data.buys.n} of {data.buys.min_buys} buys so far: the comparison with the S&amp;P 500 ETF means little before that.</p>}
        {data && !hide && <WeeklyBars rows={data.buys.rows} />}
        <div className="tr-table" role="table">
          <div className="tr-row tr-row-buys tr-head" role="row">
            <span>Week</span><span className="tr-num">Bought</span><span className="tr-num">Now</span><span className="tr-num">Return</span><span className="tr-num">vs S&amp;P</span>
          </div>
          {(data?.buys.rows ?? []).slice(0, 12).map((b, i) => (
            <div key={`${b.period}:${b.date}:${i}`} className="tr-row tr-row-buys" role="row">
              <span className="tr-name"><b>{b.period}</b><i>{shortDate(b.date)}{b.state !== 'done' ? ` · ${b.state}` : ''}{b.tier ? ` · ${b.tier}` : ''}</i></span>
              <span className="tr-num">{amt(b.bought, wonShort)}</span>
              <span className="tr-num">{amt(b.value_now, wonShort)}</span>
              <span className="tr-num">{hide ? MASK : signedPct(b.ret)}</span>
              <span className="tr-num">{hide ? MASK : signedPct(b.ret - b.bench)}</span>
            </div>
          ))}
          {data && data.buys.rows.length === 0 && <p className="tr-muted">No weekly buy has run yet.</p>}
        </div>
      </section>

      {data?.daytrade && (
        <section className="assets-section tr-wide">
          <div className="section-label">Day trade</div>
          {masked ? <p className="tr-muted">{MASK}</p> : <DayTradeBars all={data.daytrade.days} />}
        </section>
      )}
    </div>
  )
}
