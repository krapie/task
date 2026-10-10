import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { useStepUp } from '../lib/useStepUp'
import StepUpBar from './StepUpBar'
import type { HealthSummary } from '../types'

const MASK = '••••'

function hoursText(h: number | null | undefined): string {
  if (h == null) return '—'
  const total = Math.round(h * 60)
  return `${Math.floor(total / 60)}시간 ${total % 60}분`
}

// 5.94 min/km -> 5'56"
function paceText(p: number | null): string {
  if (p == null) return '—'
  const sec = Math.round(p * 60)
  return `${Math.floor(sec / 60)}'${String(sec % 60).padStart(2, '0')}"`
}

function kst(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', ...opts })
}

function num(n: number | null | undefined, suffix = ''): string {
  return n == null ? '—' : `${n.toLocaleString('ko-KR')}${suffix}`
}

function ofGoal(value: number | null | undefined, goal: number | null | undefined, unit: string): string {
  if (value == null) return '—'
  return goal ? `${value.toLocaleString('ko-KR')} / ${goal.toLocaleString('ko-KR')}${unit}` : `${value.toLocaleString('ko-KR')}${unit}`
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
      if (!s) setError('아직 가져온 건강 데이터가 없습니다')
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
  const night = summary?.lastNight

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
        <h3 className="assets-section-title">
          활동 · {show(kst(summary?.asOf, { month: 'long', day: 'numeric', weekday: 'short' }))}
        </h3>
        <div className="assets-stat-grid">
          <div className="assets-stat assets-stat-primary">
            <span className="assets-stat-label">걸음</span>
            <span className="assets-stat-value">{show(num(day?.steps))}</span>
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">활동 에너지</span>
            <span className="assets-stat-value">{show(ofGoal(day?.activeKcal, day?.activeGoal, ' kcal'))}</span>
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">운동</span>
            <span className="assets-stat-value">{show(ofGoal(day?.exerciseMin, day?.exerciseGoal, '분'))}</span>
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">서 있기</span>
            <span className="assets-stat-value">{show(ofGoal(day?.standHours, day?.standGoal, '시간'))}</span>
          </div>
        </div>
      </div>

      <div className="assets-section">
        <h3 className="assets-section-title">최근 7일 평균</h3>
        <div className="assets-stat-grid">
          <div className="assets-stat">
            <span className="assets-stat-label">걸음</span>
            <span className="assets-stat-value">{show(num(week?.stepsAvg))}</span>
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">수면</span>
            <span className="assets-stat-value">{show(hoursText(week?.sleepAvgH))}</span>
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">안정 시 심박수</span>
            <span className="assets-stat-value">{show(num(week?.restingHr, ' bpm'))}</span>
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">심박 변이 (HRV)</span>
            <span className="assets-stat-value">{show(num(week?.hrvMs, ' ms'))}</span>
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">VO2max</span>
            <span className="assets-stat-value">{show(num(summary?.vo2max?.value))}</span>
          </div>
        </div>
      </div>

      <div className="assets-section">
        <h3 className="assets-section-title">지난밤 수면</h3>
        <ul className="assets-category-list">
          <li><span>수면 시간</span><span>{show(hoursText(night?.asleepH))}</span></li>
          <li><span>깊은 수면</span><span>{show(hoursText(night?.deepH))}</span></li>
          <li><span>코어 수면</span><span>{show(hoursText(night?.coreH))}</span></li>
          <li><span>렘 수면</span><span>{show(hoursText(night?.remH))}</span></li>
          <li><span>깨어 있음</span><span>{show(hoursText(night?.awakeH))}</span></li>
          <li>
            <span>취침 · 기상</span>
            <span>{show(`${kst(night?.bedtime, { hour: '2-digit', minute: '2-digit' })} · ${kst(night?.wakeTime, { hour: '2-digit', minute: '2-digit' })}`)}</span>
          </li>
        </ul>
      </div>

      <div className="assets-section">
        <h3 className="assets-section-title">최근 러닝</h3>
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
          {summary && !masked && summary.runs.length === 0 && <li><span>기록 없음</span><span /></li>}
        </ul>
      </div>

      {unlocked && summary && (
        <div className="assets-section">
          <h3 className="assets-section-title">데이터</h3>
          <p className="assets-sync-info">
            내보낸 시각 {kst(summary.exportedAt, { dateStyle: 'medium', timeStyle: 'short' })}
            {' · '}가져온 시각 {kst(summary.importedAt, { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
          <p className="assets-locked-sub">
            iPhone 건강 앱에서 내보낸 export.zip을 Drive의 health 폴더에 올리면 매시 15분에 반영됩니다.
          </p>
        </div>
      )}

      <a className="assets-grafana-link" href="https://dashboard.kevinprk.com/d/health" target="_blank" rel="noreferrer">
        Grafana에서 상세 보기 →
      </a>
    </div>
  )
}
