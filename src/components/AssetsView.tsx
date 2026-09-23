import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../lib/api'
import type { AssetSummary, FinanceStatus, PasskeyCredential, FinanceNotifySettings } from '../types'

const IDLE_LOCK_MS = 5 * 60_000

function formatKRW(n: number): string {
  return `₩${n.toLocaleString('ko-KR')}`
}

// Rough device label from the UA string, used instead of prompting for a
// name — see the focus-loss note in handleRegister.
function guessDeviceName(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Android/.test(ua)) return 'Android'
  if (/Windows/.test(ua)) return 'Windows'
  return '기기'
}

function LockIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
  )
}
function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  )
}
function EyeSlashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.774 3.162 10.066 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  )
}

interface AssetsViewProps {
  isAuth: boolean
}

export default function AssetsView({ isAuth }: AssetsViewProps) {
  const [locked, setLocked] = useState(!api.assets.hasToken())
  const [credentials, setCredentials] = useState<PasskeyCredential[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [masked, setMasked] = useState(true)
  const [summary, setSummary] = useState<AssetSummary | null>(null)
  const [status, setStatus] = useState<FinanceStatus | null>(null)
  const [passwordSet, setPasswordSet] = useState<boolean | null>(null)
  const [notify, setNotify] = useState<FinanceNotifySettings | null>(null)
  const [remaining, setRemaining] = useState(0)

  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const lockNow = useCallback(() => {
    api.assets.clearToken()
    setLocked(true)
    setMasked(true)
    // Drop the fetched amounts too, not just mask them — a locked tab
    // should hold nothing sensitive in memory to inspect.
    setSummary(null)
    setStatus(null)
  }, [])

  // Always know whether any passkey exists, even while locked, so the
  // locked screen can offer "register" vs "unlock" — this list itself
  // carries no amounts, just device metadata, safe under the general session.
  useEffect(() => {
    if (!isAuth) return
    api.passkey.listCredentials().then(setCredentials).catch(() => {})
  }, [locked, isAuth])

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
      if (err instanceof Error && err.message === 'ASSET_SESSION_EXPIRED') {
        lockNow()
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load')
      }
    } finally {
      setBusy(false)
    }
  }, [lockNow])

  useEffect(() => {
    if (!locked) loadAll()
  }, [locked, loadAll])

  // Backgrounding this tab must not leave amounts sitting in a PWA app-switcher
  // screenshot — re-lock immediately, don't wait for the idle timer.
  useEffect(() => {
    function onVisibility() {
      if (document.hidden) lockNow()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [lockNow])

  // 5-minute idle auto-lock while unlocked.
  useEffect(() => {
    if (locked) return
    function resetIdle() {
      if (idleTimer.current) clearTimeout(idleTimer.current)
      idleTimer.current = setTimeout(lockNow, IDLE_LOCK_MS)
    }
    resetIdle()
    const events: (keyof DocumentEventMap)[] = ['mousemove', 'keydown', 'touchstart', 'scroll']
    events.forEach(e => document.addEventListener(e, resetIdle))
    return () => {
      events.forEach(e => document.removeEventListener(e, resetIdle))
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [locked, lockNow])

  // Countdown display for the asset-token TTL.
  useEffect(() => {
    if (locked) return
    const id = setInterval(() => {
      const ms = api.assets.remainingMs()
      setRemaining(ms)
      if (ms <= 0) lockNow()
    }, 1000)
    return () => clearInterval(id)
  }, [locked, lockNow])

  async function handleRegister() {
    setBusy(true)
    setError(null)
    try {
      // No window.prompt() (or any blocking dialog) before this call —
      // WebAuthn's navigator.credentials.create() throws "document is not
      // focused" if the document lost focus just before it runs, which a
      // native prompt() reliably does. Device name is auto-detected instead.
      await api.passkey.register(guessDeviceName())
      setCredentials(await api.passkey.listCredentials())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey registration failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleUnlock() {
    setBusy(true)
    setError(null)
    try {
      await api.passkey.authenticate()
      setLocked(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey unlock failed')
    } finally {
      setBusy(false)
    }
  }

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
      if (err instanceof Error && err.message === 'ASSET_SESSION_EXPIRED') lockNow()
      else setError(err instanceof Error ? err.message : 'Sync failed')
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
      setError(err instanceof Error ? err.message : 'Failed to set password')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveCredential(id: string) {
    if (!window.confirm('이 패스키를 삭제할까요?')) return
    await api.passkey.removeCredential(id)
    setCredentials(await api.passkey.listCredentials())
  }

  async function updateNotify(patch: Partial<FinanceNotifySettings>) {
    const next = { ...notify, ...patch } as FinanceNotifySettings
    setNotify(next)
    await api.assets.updateNotifySettings(patch).catch(() => {})
  }

  if (!isAuth) {
    return (
      <div className="assets-locked">
        <LockIcon />
        <p className="assets-locked-title">로그인이 필요합니다</p>
        <p className="assets-locked-sub">자산 탭은 게스트 모드에서 사용할 수 없습니다</p>
      </div>
    )
  }

  if (locked) {
    return (
      <div className="assets-locked">
        <LockIcon />
        <p className="assets-locked-title">
          {credentials.length === 0 ? '자산 탭을 보려면 패스키를 등록하세요' : '자산 탭이 잠겨 있습니다'}
        </p>
        <p className="assets-locked-sub">순자산, 지출 내역 등 금융 데이터는 별도 인증이 필요합니다</p>
        {error && <p className="assets-error">{error}</p>}
        {credentials.length === 0 ? (
          <button className="btn-primary" onClick={handleRegister} disabled={busy}>패스키 등록</button>
        ) : (
          <button className="btn-primary" onClick={handleUnlock} disabled={busy}>패스키로 잠금 해제</button>
        )}
      </div>
    )
  }

  const remainMin = Math.floor(remaining / 60_000)
  const remainSec = Math.floor((remaining % 60_000) / 1000)

  return (
    <div className="assets-view">
      <div className="assets-topbar">
        <span className="assets-status-chip">🔓 인증됨 · {remainMin}:{String(remainSec).padStart(2, '0')} 남음</span>
        <div className="assets-topbar-actions">
          <button className="btn-ghost btn-sm" onClick={() => setMasked(m => !m)}>
            {masked ? <EyeIcon /> : <EyeSlashIcon />} {masked ? '표시' : '숨기기'}
          </button>
          <button className="btn-ghost btn-sm" onClick={lockNow}>잠금</button>
        </div>
      </div>

      {error && <p className="assets-error">{error}</p>}

      {summary && (
        <>
          <div className="assets-stat-grid">
            <div className="assets-stat assets-stat-primary">
              <span className="assets-stat-label">순자산</span>
              <span className="assets-stat-value">{masked ? '••••••••' : formatKRW(summary.netWorth)}</span>
            </div>
            <div className="assets-stat">
              <span className="assets-stat-label">총자산</span>
              <span className="assets-stat-value">{masked ? '••••••••' : formatKRW(summary.totalAssets)}</span>
            </div>
            <div className="assets-stat">
              <span className="assets-stat-label">총부채</span>
              <span className="assets-stat-value">{masked ? '••••••••' : formatKRW(summary.totalDebt)}</span>
            </div>
            <div className="assets-stat">
              <span className="assets-stat-label">신용점수</span>
              <span className="assets-stat-value">{masked ? '••••' : (summary.creditScore ?? '—')}</span>
            </div>
          </div>

          <div className="assets-section">
            <h3 className="assets-section-title">이번 달</h3>
            <div className="assets-stat-grid">
              <div className="assets-stat">
                <span className="assets-stat-label">수입</span>
                <span className="assets-stat-value">{masked ? '••••••' : formatKRW(summary.thisMonth.income)}</span>
              </div>
              <div className="assets-stat">
                <span className="assets-stat-label">지출</span>
                <span className="assets-stat-value assets-negative">{masked ? '••••••' : formatKRW(summary.thisMonth.expense)}</span>
              </div>
              <div className="assets-stat">
                <span className="assets-stat-label">순저축</span>
                <span className="assets-stat-value">{masked ? '••••••' : formatKRW(summary.thisMonth.netSavings)}</span>
              </div>
              <div className="assets-stat">
                <span className="assets-stat-label">투자 손익</span>
                <span className={`assets-stat-value${summary.investment.pnl < 0 ? ' assets-negative' : ''}`}>
                  {masked ? '••••••' : formatKRW(summary.investment.pnl)}
                </span>
              </div>
            </div>
          </div>

          <div className="assets-section">
            <h3 className="assets-section-title">자산 구성</h3>
            <ul className="assets-category-list">
              {summary.categoryBreakdown.map(c => (
                <li key={c.category}>
                  <span>{c.category}</span>
                  <span>{masked ? '••••••' : formatKRW(c.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

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

      <div className="assets-section">
        <h3 className="assets-section-title">패스키</h3>
        <ul className="assets-credential-list">
          {credentials.map(c => (
            <li key={c.id}>
              <span>{c.device_name || '이름 없는 기기'}</span>
              <button className="btn-ghost btn-sm" onClick={() => handleRemoveCredential(c.id)}>삭제</button>
            </li>
          ))}
        </ul>
        <button className="btn-ghost btn-sm" onClick={handleRegister} disabled={busy}>새 패스키 추가</button>
      </div>

      <a className="assets-grafana-link" href="https://dashboard.kevinprk.com/d/finance-assets" target="_blank" rel="noreferrer">
        Grafana에서 상세 보기 →
      </a>
    </div>
  )
}
