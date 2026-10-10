import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { useStepUp } from '../lib/useStepUp'
import StepUpBar from './StepUpBar'
import type { AssetSummary, FinanceStatus, FinanceNotifySettings } from '../types'

function formatKRW(n: number): string {
  return `₩${n.toLocaleString('ko-KR')}`
}

// Shown in every amount slot while locked or hidden.
const MASK = '••••••'

interface AssetsViewProps {
  isAuth: boolean
}

// The tab opens without a passkey but shows placeholders only; nothing is
// requested from /api/assets/* until the passkey step-up succeeds.
export default function AssetsView({ isAuth }: AssetsViewProps) {
  const [masked, setMasked] = useState(false)
  const [summary, setSummary] = useState<AssetSummary | null>(null)
  const [status, setStatus] = useState<FinanceStatus | null>(null)
  const [passwordSet, setPasswordSet] = useState<boolean | null>(null)
  const [notify, setNotify] = useState<FinanceNotifySettings | null>(null)

  const clearData = useCallback(() => {
    setMasked(false)
    setSummary(null)
    setStatus(null)
    setPasswordSet(null)
    setNotify(null)
  }, [])
  const { unlocked, busy, setBusy, error, setError, remaining, lock, unlock, handleError } =
    useStepUp('assets', isAuth, clearData)

  const loadAll = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const [s, st, pw, ns] = await Promise.all([
        api.assets.getSummary(),
        api.assets.getStatus(),
        api.assets.getPasswordStatus(),
        api.assets.getNotifySettings(),
      ])
      setSummary(s)
      setStatus(st)
      setPasswordSet(pw.isSet)
      setNotify(ns)
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }, [handleError, setBusy, setError])

  useEffect(() => {
    if (unlocked) loadAll()
  }, [unlocked, loadAll])

  async function handleSync() {
    setBusy(true)
    setError(null)
    try {
      const result = await api.assets.sync()
      setError(`동기화 완료: ${result.rowsTotal}건 (신규 ${result.rowsNew} / 갱신 ${result.rowsUpdated})`)
      const [s, st] = await Promise.all([api.assets.getSummary(), api.assets.getStatus()])
      setSummary(s)
      setStatus(st)
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  async function handleSetPassword() {
    const pw = window.prompt('뱅크샐러드 내보내기 비밀번호')
    if (!pw) return
    setBusy(true)
    setError(null)
    try {
      await api.assets.setPassword(pw)
      setPasswordSet(true)
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  async function updateNotify(patch: Partial<FinanceNotifySettings>) {
    const next = { ...notify, ...patch } as FinanceNotifySettings
    setNotify(next)
    await api.assets.updateNotifySettings(patch).catch(handleError)
  }

  const hide = masked || !summary
  const amount = (n: number | undefined) => (hide || n === undefined ? MASK : formatKRW(n))

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

      <div className="assets-stat-grid">
        <div className="assets-stat assets-stat-primary">
          <span className="assets-stat-label">순자산</span>
          <span className="assets-stat-value">{amount(summary?.netWorth)}</span>
        </div>
        <div className="assets-stat">
          <span className="assets-stat-label">총자산</span>
          <span className="assets-stat-value">{amount(summary?.totalAssets)}</span>
        </div>
        <div className="assets-stat">
          <span className="assets-stat-label">총부채</span>
          <span className="assets-stat-value">{amount(summary?.totalDebt)}</span>
        </div>
        <div className="assets-stat">
          <span className="assets-stat-label">신용점수</span>
          <span className="assets-stat-value">{hide ? '••••' : (summary?.creditScore ?? '—')}</span>
        </div>
      </div>

      <div className="assets-section">
        <h3 className="assets-section-title">이번 달</h3>
        <div className="assets-stat-grid">
          <div className="assets-stat">
            <span className="assets-stat-label">수입</span>
            <span className="assets-stat-value">{amount(summary?.thisMonth.income)}</span>
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">지출</span>
            <span className={`assets-stat-value${hide ? '' : ' assets-negative'}`}>{amount(summary?.thisMonth.expense)}</span>
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">순저축</span>
            <span className="assets-stat-value">{amount(summary?.thisMonth.netSavings)}</span>
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">투자 손익</span>
            <span className={`assets-stat-value${!hide && summary && summary.investment.pnl < 0 ? ' assets-negative' : ''}`}>
              {amount(summary?.investment.pnl)}
            </span>
          </div>
        </div>
      </div>

      <div className="assets-section">
        <h3 className="assets-section-title">자산 구성</h3>
        <ul className="assets-category-list">
          {summary
            ? summary.categoryBreakdown.map(c => (
                <li key={c.category}>
                  <span>{masked ? '••••' : c.category}</span>
                  <span>{amount(c.amount)}</span>
                </li>
              ))
            : [0, 1, 2].map(i => (
                <li key={i}><span>••••</span><span>{MASK}</span></li>
              ))}
        </ul>
      </div>

      {unlocked && (
        <>
          <div className="assets-section">
            <h3 className="assets-section-title">동기화</h3>
            {status && (
              <p className="assets-sync-info">
                마지막 {status.lastIngest ? new Date(status.lastIngest.ingested_at).toLocaleString('ko-KR') : '없음'}
                {' · '}{status.transactionCount.toLocaleString('ko-KR')}건
              </p>
            )}
            <button className="btn-primary btn-sm" onClick={handleSync} disabled={busy}>지금 동기화</button>
          </div>

          <div className="assets-section">
            <h3 className="assets-section-title">내보내기 비밀번호</h3>
            <p className="assets-sync-info">{passwordSet ? '설정됨 ●●●●' : '설정되지 않음'}</p>
            <button className="btn-ghost btn-sm" onClick={handleSetPassword} disabled={busy}>
              {passwordSet ? '변경' : '설정'}
            </button>
          </div>

          {notify && (
            <div className="assets-section">
              <h3 className="assets-section-title">월간 알림</h3>
              <div className="toggle-row">
                <span className="toggle-label">
                  매월 {notify.financeNotifyDay}일 {notify.financeNotifyHour.padStart(2, '0')}:{notify.financeNotifyMinute.padStart(2, '0')}
                </span>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={notify.financeNotifyEnabled === 'true'}
                    onChange={e => updateNotify({ financeNotifyEnabled: String(e.target.checked) })}
                  />
                  <span className="toggle-track" />
                </label>
              </div>
            </div>
          )}
        </>
      )}

      <div className="assets-section">
        <h3 className="assets-section-title">패스키</h3>
        <p className="assets-locked-sub">패스키는 kevinprk 계정에서 관리합니다 (모든 앱 공용).</p>
        <a className="btn-ghost btn-sm" href={api.passkey.manageURL} target="_blank" rel="noreferrer">계정에서 패스키 관리</a>
      </div>

      <a className="assets-grafana-link" href="https://dashboard.kevinprk.com/d/finance-assets" target="_blank" rel="noreferrer">
        Grafana에서 상세 보기 →
      </a>
    </div>
  )
}
