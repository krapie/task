import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { useStepUp } from '../lib/useStepUp'
import StepUpBar from './StepUpBar'
import { Empty, Meter } from './Ui'
import type { HealthSummary } from '../types'

const MASK = '••••'

function hoursText(h: number | null | undefined): string {
  if (h == null) return '—'
  const total = Math.round(h * 60)
  return `${Math.floor(total / 60)}h ${total % 60}m`
}

// 5.94 min/km -> 5'56"
function paceText(p: number | null): string {
  if (p == null) return '—'
  const sec = Math.round(p * 60)
  return `${Math.floor(sec / 60)}'${String(sec % 60).padStart(2, '0')}"`
}

function kst(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Seoul', ...opts })
}

function num(n: number | null | undefined, suffix = ''): string {
  return n == null ? '—' : `${n.toLocaleString('en-US')}${suffix}`
}

function ofGoal(value: number | null | undefined, goal: number | null | undefined, unit: string): string {
  if (value == null) return '—'
  return goal ? `${value.toLocaleString('en-US')} / ${goal.toLocaleString('en-US')}${unit}` : `${value.toLocaleString('en-US')}${unit}`
}

const STAGES = [
  { key: 'deepH', label: 'Deep', shade: 'var(--kp-fg)' },
  { key: 'coreH', label: 'Core', shade: 'var(--kp-fg-3)' },
  { key: 'remH', label: 'REM', shade: 'var(--kp-fg-4)' },
  { key: 'awakeH', label: 'Awake', shade: 'var(--kp-border-strong)' },
] as const

function SleepStages({ night }: { night: NonNullable<HealthSummary['lastNight']> }) {
  const total = STAGES.reduce((sum, st) => sum + (night[st.key] ?? 0), 0)
  if (!total) return null
  return (
    <>
      <div className="sleep-bar" aria-hidden="true">
        {STAGES.map(st => (night[st.key] ? <span key={st.key} style={{ flex: night[st.key]!, background: st.shade }} /> : null))}
      </div>
      <ul className="sleep-legend">
        {STAGES.map(st => (
          <li key={st.key}><i style={{ background: st.shade }} />{st.label} {hoursText(night[st.key])}</li>
        ))}
      </ul>
    </>
  )
}

interface HealthViewProps {
  isAuth: boolean
}

// Apple Health summary behind the same passkey step-up as Assets. The tab
// opens without a passkey but shows placeholders only; nothing is requested
// from /api/health-data/* until the step-up succeeds. GPS routes and raw
// samples never reach this app (the server can only read hk_task_summary).
export default function HealthView({ isAuth }: HealthViewProps) {
  const [masked, setMasked] = useState(false)
  const [summary, setSummary] = useState<HealthSummary | null>(null)

  const clearData = useCallback(() => {
    setMasked(false)
    setSummary(null)
  }, [])
  const { unlocked, busy, setBusy, error, setError, remaining, lock, unlock, handleError } =
    useStepUp('health', isAuth, clearData)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const s = await api.health.getSummary()
      if (!s) setError('No health data imported yet')
      setSummary(s)
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }, [handleError, setBusy, setError])

  useEffect(() => {
    if (unlocked) load()
  }, [unlocked, load])

  const hide = masked || !summary
  const show = (text: string) => (hide ? MASK : text)
  const day = summary?.day
  const week = summary?.week

  if (!unlocked) {
    return (
      <div className="assets-view">
        {error && <p className="assets-error">{error}</p>}
        <Empty icon="lock" title="Health is locked" hint="Verify with your passkey to see your data. Everything stays hidden until then." action={{ label: 'Show with passkey', onClick: unlock, disabled: busy }} />
      </div>
    )
  }

  return (
    <div className="assets-view">
      <StepUpBar
        unlocked={unlocked}
        busy={busy}
        remaining={remaining}
        masked={masked}
        onToggleMask={() => setMasked(m => !m)}
        onUnlock={unlock}
        onLock={lock}
      />

      {error && <p className="assets-error">{error}</p>}

      <div className="assets-section">
        <div className="section-label">7-day average</div>
        <div className="assets-stat-grid">
          <div className="assets-stat assets-stat-primary">
            <span className="assets-stat-label">Sleep</span>
            <span className="assets-stat-value">{show(hoursText(week?.sleepAvgH))}</span>
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">Steps</span>
            <span className="assets-stat-value">{show(num(week?.stepsAvg))}</span>
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">Resting HR</span>
            <span className="assets-stat-value">{show(num(week?.restingHr, ' bpm'))}</span>
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">HRV</span>
            <span className="assets-stat-value">{show(num(week?.hrvMs, ' ms'))}</span>
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">VO2max</span>
            <span className="assets-stat-value">{show(num(summary?.vo2max?.value))}</span>
          </div>
        </div>
      </div>

      {!hide && summary?.lastNight && (
        <div className="assets-section">
          <div className="section-label">Last night · {hoursText(summary.lastNight.asleepH)}</div>
          <SleepStages night={summary.lastNight} />
        </div>
      )}

      <div className="assets-section">
        <div className="section-label">
          Activity · {show(kst(summary?.asOf, { month: 'long', day: 'numeric', weekday: 'short' }))}
        </div>
        <div className="assets-stat-grid">
          <div className="assets-stat">
            <span className="assets-stat-label">Steps</span>
            <span className="assets-stat-value">{show(num(day?.steps))}</span>
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">Active energy</span>
            <span className="assets-stat-value">{show(ofGoal(day?.activeKcal, day?.activeGoal, ' kcal'))}</span>
            {!hide && <Meter value={day?.activeKcal} max={day?.activeGoal} label="Active energy" />}
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">Exercise</span>
            <span className="assets-stat-value">{show(ofGoal(day?.exerciseMin, day?.exerciseGoal, ' min'))}</span>
            {!hide && <Meter value={day?.exerciseMin} max={day?.exerciseGoal} label="Exercise" />}
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">Stand</span>
            <span className="assets-stat-value">{show(ofGoal(day?.standHours, day?.standGoal, ' h'))}</span>
            {!hide && <Meter value={day?.standHours} max={day?.standGoal} label="Stand" />}
          </div>
        </div>
      </div>

      <div className="assets-section">
        <div className="section-label">Recent runs</div>
        <ul className="assets-category-list">
          {summary && !masked
            ? summary.runs.map(r => (
                <li key={r.at}>
                  <span>{kst(r.at, { month: 'numeric', day: 'numeric' })}</span>
                  <span>{num(r.km, ' km')} · {paceText(r.paceMinKm)} · {num(r.avgHr, ' bpm')}</span>
                </li>
              ))
            : [0, 1, 2].map(i => (
                <li key={i}><span>{MASK}</span><span>{MASK}</span></li>
              ))}
          {summary && !masked && summary.runs.length === 0 && <li><span>No runs recorded</span><span /></li>}
        </ul>
      </div>

      {unlocked && summary && (
        <div className="assets-section">
          <div className="section-label">Data</div>
          <p className="assets-sync-info">
            Exported {kst(summary.exportedAt, { dateStyle: 'medium', timeStyle: 'short' })}
            {' · '}Imported {kst(summary.importedAt, { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
          <p className="assets-locked-sub">
            Upload export.zip from the iPhone Health app to the health folder in Drive; it is picked up at 15 past each hour.
          </p>
        </div>
      )}

      <a className="assets-grafana-link" href="https://dashboard.kevinprk.com/d/health" target="_blank" rel="noreferrer">
        View details in Grafana →
      </a>
    </div>
  )
}
