import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useStepUp } from '../lib/useStepUp'
import { pct, shortDate, signedPct, signedWon, won, wonShort } from '../lib/format'
import type { TraderSummary } from '../types'
import StepUpBar from './StepUpBar'
import { Spark } from './Charts'
import { Empty } from './Ui'

const MASK = '••••••'
const VERDICT = { clear: 'All clear', attention: 'Needs a look', bad: 'Problem' } as const

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
  const lo = hist.length ? Math.min(...hist.map(h => Math.min(h[1], h[2]))) : 0
  const hi = hist.length ? Math.max(...hist.map(h => Math.max(h[1], h[2]))) : 0

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
          <span className="assets-stat-value">{hide || !t ? MASK : signedWon(t.daytrade_net)}</span>
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
            </div>
            <div className="tr-chart-axis">
              <span>{shortDate(hist[0][0])}</span>
              <span>solid: value · dashed: cost ({data ? wonShort(data.portfolio.cost) : ''})</span>
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
    </div>
  )
}
