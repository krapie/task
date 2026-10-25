import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { hoursText, num, pct, shortDate, signedPct, signedWon, won, wonShort } from '../lib/format'
import { useStepUp } from '../lib/useStepUp'
import type { AssetSummary, HealthSummary, TraderSummary } from '../types'
import { Ring, SplitBar, PairBars, Spark } from './Charts'
import { Icon } from './Icons'
import { Panel } from './OverviewPanel'
import StepUpBar from './StepUpBar'

export type SecureView = 'health' | 'assets' | 'trader'

const MASK = '••••••'
// `loaded` tells "not asked yet" from "asked, nothing there" (a null health summary is a valid answer).
type Slice<T> = { data: T | null; failed: boolean; loaded: boolean }
const empty = <T,>(): Slice<T> => ({ data: null, failed: false, loaded: false })

// The lower band of the Overview: health, assets and the trader. All private, so it is locked behind the
// passkey step-up like the Assets, Health and Trader tabs (one unlock, one shared token): while locked it
// holds placeholders and requests nothing; on Lock, backgrounding or expiry the fetched values are dropped.
export default function OverviewSecure({ isAuth, onOpen }: { isAuth: boolean; onOpen: (v: SecureView) => void }) {
  const [masked, setMasked] = useState(false)
  const [health, setHealth] = useState<Slice<HealthSummary | null>>(empty())
  const [assets, setAssets] = useState<Slice<AssetSummary>>(empty())
  const [trader, setTrader] = useState<Slice<TraderSummary>>(empty())

  // A request that returns after a lock must not put data back: every lock moves the generation on.
  const gen = useRef(0)
  const clearData = useCallback(() => {
    gen.current++
    setMasked(false)
    setHealth(empty())
    setAssets(empty())
    setTrader(empty())
  }, [])
  const { unlocked, busy, setBusy, error, setError, remaining, lock, unlock, handleError } = useStepUp('overview', isAuth, clearData)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    // Each panel fails on its own; an expired or refused passkey relocks the whole band.
    const g = gen.current
    const [h, a, t] = await Promise.allSettled([api.health.getSummary(), api.assets.getSummary(), api.trader.getSummary()])
    if (g !== gen.current) { setBusy(false); return } // locked meanwhile
    const session = [h, a, t].find(r => r.status === 'rejected' && r.reason instanceof Error && /^(ASSET_SESSION_EXPIRED|STEP_UP_FORBIDDEN)$/.test(r.reason.message))
    if (session && session.status === 'rejected') handleError(session.reason)
    else {
      setHealth(h.status === 'fulfilled' ? { data: h.value, failed: false, loaded: true } : { data: null, failed: true, loaded: true })
      setAssets(a.status === 'fulfilled' ? { data: a.value, failed: false, loaded: true } : { data: null, failed: true, loaded: true })
      setTrader(t.status === 'fulfilled' ? { data: t.value, failed: false, loaded: true } : { data: null, failed: true, loaded: true })
    }
    setBusy(false)
  }, [handleError, setBusy, setError])
  useEffect(() => { if (unlocked) load() }, [unlocked, load])

  return (
    <div className="ov-band ov-secure">
      <div className="ov-secure-head">
        <span className="ov-secure-title"><Icon name="lock" size={14} /> Private</span>
        <StepUpBar unlocked={unlocked} busy={busy} remaining={remaining} masked={masked} onToggleMask={() => setMasked(m => !m)} onUnlock={unlock} onLock={lock} />
      </div>
      {error && <p className="ov-secure-error">{error}</p>}
      <div className="ov-secure-grid">
        <HealthPanel unlocked={unlocked} masked={masked} s={health} onOpen={() => onOpen('health')} />
        <AssetsPanel unlocked={unlocked} masked={masked} s={assets} onOpen={() => onOpen('assets')} />
        <TraderPanel unlocked={unlocked} masked={masked} s={trader} onOpen={() => onOpen('trader')} />
      </div>
    </div>
  )
}

// What a panel shows while locked, loading or failed, so the band keeps its shape.
function Placeholder({ unlocked, failed, loaded, hint }: { unlocked: boolean; failed: boolean; loaded: boolean; hint: string }) {
  return (
    <div className="ov-locked">
      <Icon name="lock" size={20} />
      <p>{!unlocked ? hint : failed ? 'Unavailable right now.' : !loaded ? 'Loading…' : 'No data yet.'}</p>
    </div>
  )
}

interface PanelProps<T> { unlocked: boolean; masked: boolean; s: Slice<T>; onOpen: () => void }

function HealthPanel({ unlocked, masked, s, onOpen }: PanelProps<HealthSummary | null>) {
  const h = s.data
  if (!unlocked || !h || masked) {
    return (
      <Panel title="Health" onOpen={onOpen} className="ov-health">
        {masked && unlocked && h ? <p className="ov-masked">{MASK}</p> : <Placeholder unlocked={unlocked} failed={s.failed} loaded={s.loaded} hint="Steps, activity rings and last night's sleep." />}
      </Panel>
    )
  }
  const d = h.day
  const night = h.lastNight
  const rings = [
    { label: 'Move', value: d?.activeKcal, goal: d?.activeGoal },
    { label: 'Exercise', value: d?.exerciseMin, goal: d?.exerciseGoal },
    { label: 'Stand', value: d?.standHours, goal: d?.standGoal },
  ]
  return (
    <Panel title="Health" count={h.asOf ? shortDate(h.asOf.slice(0, 10)) : ''} onOpen={onOpen} className="ov-health">
      <div className="ov-hero">
        <div>
          <b className="ov-big">{num(d?.steps)}</b>
          <span className="ov-sub-inline">steps{h.week?.stepsAvg != null ? ` · avg ${num(h.week.stepsAvg)}` : ''}</span>
        </div>
        <div className="ov-rings">
          {rings.map(r => (
            <div key={r.label} className="ov-ring-item">
              <Ring value={r.value ?? 0} max={r.goal ?? 0} size={46} stroke={5} label={r.label}>
                <b className="ov-ring-pct">{r.goal ? Math.min(Math.round(((r.value ?? 0) / r.goal) * 100), 999) : '–'}</b>
              </Ring>
              <span>{r.label}</span>
            </div>
          ))}
        </div>
      </div>
      {night && (
        <div className="ov-block">
          <div className="ov-sub">Last night · {hoursText(night.asleepH)}</div>
          <SplitBar parts={[
            { label: 'Deep', value: night.deepH ?? 0 }, { label: 'Core', value: night.coreH ?? 0 },
            { label: 'REM', value: night.remH ?? 0 }, { label: 'Awake', value: night.awakeH ?? 0 },
          ]} />
        </div>
      )}
      <ul className="ov-facts">
        <li><span>Resting HR</span><b>{num(h.week?.restingHr, ' bpm')}</b></li>
        <li><span>HRV</span><b>{num(h.week?.hrvMs, ' ms')}</b></li>
        {h.vo2max && <li><span>VO₂ max</span><b>{h.vo2max.value}</b></li>}
      </ul>
    </Panel>
  )
}

function AssetsPanel({ unlocked, masked, s, onOpen }: PanelProps<AssetSummary>) {
  const a = s.data
  if (!unlocked || !a || masked) {
    return (
      <Panel title="Assets" onOpen={onOpen} className="ov-assets">
        {masked && unlocked && a ? <p className="ov-masked">{MASK}</p> : <Placeholder unlocked={unlocked} failed={s.failed} loaded={s.loaded} hint="Net worth, this month's income and spending, allocation." />}
      </Panel>
    )
  }
  const cats = [...a.categoryBreakdown].filter(c => c.amount > 0).sort((x, y) => y.amount - x.amount)
  const top = cats.slice(0, 4)
  const rest = cats.slice(4).reduce((t, c) => t + c.amount, 0)
  const parts = [...top.map(c => ({ label: c.category, value: c.amount })), ...(rest > 0 ? [{ label: 'Other', value: rest }] : [])]
  const m = a.thisMonth
  return (
    <Panel title="Assets" onOpen={onOpen} className="ov-assets">
      <div className="ov-hero">
        <div>
          <b className="ov-big">{won(a.netWorth)}</b>
          <span className="ov-sub-inline">net worth{a.totalDebt ? ` · debt ${wonShort(a.totalDebt)}` : ''}</span>
        </div>
      </div>
      <div className="ov-block">
        <div className="ov-sub">This month · net {signedWon(m.netSavings)}</div>
        <PairBars rows={[
          { label: 'Income', value: m.income, display: wonShort(m.income) },
          { label: 'Spent', value: m.expense, display: wonShort(m.expense) },
        ]} />
      </div>
      {parts.length > 0 && (
        <div className="ov-block">
          <div className="ov-sub">Allocation</div>
          <SplitBar parts={parts} />
        </div>
      )}
      <ul className="ov-facts">
        <li><span>Investments</span><b>{wonShort(a.investment.value)}</b></li>
        <li><span>P&amp;L</span><b>{signedWon(a.investment.pnl)}</b></li>
        {a.creditScore != null && <li><span>Credit</span><b>{a.creditScore}</b></li>}
      </ul>
    </Panel>
  )
}

function TraderPanel({ unlocked, masked, s, onOpen }: PanelProps<TraderSummary>) {
  const t = s.data
  if (!unlocked || !t || masked) {
    return (
      <Panel title="Trader" onOpen={onOpen} className="ov-trader">
        {masked && unlocked && t ? <p className="ov-masked">{MASK}</p> : <Placeholder unlocked={unlocked} failed={s.failed} loaded={s.loaded} hint="Portfolio value, the ETF mix and the latest weekly buy." />}
      </Panel>
    )
  }
  const series = t.portfolio.history.map(h => h[1])
  const etfs = [...t.etfs].sort((a, b) => b.share - a.share)
  const parts = etfs.map(e => ({ label: e.name.replace(/^KODEX\s*/, ''), value: e.share }))
  const last = t.buys.rows[0]
  return (
    <Panel title="Trader" count={`${t.env === 'real' ? 'Real' : 'Paper'} · ${t.verdict.level === 'clear' ? 'all clear' : t.verdict.level === 'attention' ? 'needs a look' : 'problem'}`} onOpen={onOpen} className="ov-trader">
      <div className="ov-hero">
        <div>
          <b className="ov-big">{won(t.trader.total_value)}</b>
          <span className="ov-sub-inline">{signedWon(t.trader.gain)} ({signedPct(t.trader.gain_pct)}) on the ETFs</span>
        </div>
      </div>
      {series.length > 1 && <div className="ov-spark"><Spark points={series} fill label="Portfolio value" /></div>}
      {parts.length > 0 && (
        <div className="ov-block">
          <div className="ov-sub">ETF mix</div>
          <SplitBar parts={parts} legend={false} />
        </div>
      )}
      <ul className="ov-facts">
        <li><span>Cash</span><b>{wonShort(t.trader.cash)}</b></li>
        <li><span>Day trade</span><b>{signedWon(t.trader.daytrade_net)}</b></li>
        {last && <li><span>Last buy · {last.period}</span><b>{wonShort(last.bought)} · {pct(last.ret)}</b></li>}
      </ul>
    </Panel>
  )
}
