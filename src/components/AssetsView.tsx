import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { useStepUp } from '../lib/useStepUp'
import StepUpBar from './StepUpBar'
import type { AssetSummary, FinanceStatus, FinanceNotifySettings } from '../types'
import { promptDialog } from '../lib/notify'
import { Empty, Meter } from './Ui'

function formatKRW(n: number): string {
  return `₩${n.toLocaleString('en-US')}`
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
      setError(`Synced ${result.rowsTotal} rows (${result.rowsNew} new, ${result.rowsUpdated} updated)`)
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
    const pw = await promptDialog({ title: 'Export password', body: 'Password for the Banksalad export file.', password: true, confirmLabel: 'Save' })
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
  const allocTotal = summary ? summary.categoryBreakdown.reduce((t, c) => t + Math.abs(c.amount), 0) : 0
  const amount = (n: number | undefined) => (hide || n === undefined ? MASK : formatKRW(n))

  if (!unlocked) {
    return (
      <div className="assets-view">
        {error && <p className="assets-error">{error}</p>}
        <Empty icon="lock" title="Assets are locked" hint="Verify with your passkey to see your numbers. Everything stays hidden until then." action={{ label: 'Show with passkey', onClick: unlock, disabled: busy }} />
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

      <div className="assets-stat-grid">
        <div className="assets-stat assets-stat-primary">
          <span className="assets-stat-label">Net worth</span>
          <span className="assets-stat-value">{amount(summary?.netWorth)}</span>
        </div>
        <div className="assets-stat">
          <span className="assets-stat-label">Total assets</span>
          <span className="assets-stat-value">{amount(summary?.totalAssets)}</span>
        </div>
        <div className="assets-stat">
          <span className="assets-stat-label">Total debt</span>
          <span className="assets-stat-value">{amount(summary?.totalDebt)}</span>
        </div>
        <div className="assets-stat">
          <span className="assets-stat-label">Credit score</span>
          <span className="assets-stat-value">{hide ? '••••' : (summary?.creditScore ?? '—')}</span>
        </div>
      </div>

      <div className="assets-section">
        <div className="section-label">This month</div>
        <div className="assets-stat-grid">
          <div className="assets-stat">
            <span className="assets-stat-label">Income</span>
            <span className="assets-stat-value">{amount(summary?.thisMonth.income)}</span>
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">Spending</span>
            <span className={`assets-stat-value${hide ? '' : ' assets-negative'}`}>{amount(summary?.thisMonth.expense)}</span>
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">Net savings</span>
            <span className="assets-stat-value">{amount(summary?.thisMonth.netSavings)}</span>
          </div>
          <div className="assets-stat">
            <span className="assets-stat-label">Investment P/L</span>
            <span className={`assets-stat-value${!hide && summary && summary.investment.pnl < 0 ? ' assets-negative' : ''}`}>
              {amount(summary?.investment.pnl)}
            </span>
          </div>
        </div>
      </div>

      <div className="assets-section">
        <div className="section-label">Allocation</div>
        <ul className="assets-category-list">
          {summary
            ? summary.categoryBreakdown.map(c => (
                <li key={c.category}>
                  <span>{masked ? '••••' : c.category}</span>
                  <span>{amount(c.amount)}</span>
                  {!hide && <Meter value={Math.abs(c.amount)} max={allocTotal} label={c.category} />}
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
            <div className="section-label">Sync</div>
            {status && (
              <p className="assets-sync-info">
                Last sync {status.lastIngest ? new Date(status.lastIngest.ingested_at).toLocaleString('en-US') : 'never'}
                {' · '}{status.transactionCount.toLocaleString('en-US')} transactions
              </p>
            )}
            <button className="btn-primary btn-sm" onClick={handleSync} disabled={busy}>Sync now</button>
          </div>

          <div className="assets-section">
            <div className="section-label">Export password</div>
            <p className="assets-sync-info">{passwordSet ? 'Set ●●●●' : 'Not set'}</p>
            <button className="btn-ghost btn-sm" onClick={handleSetPassword} disabled={busy}>
              {passwordSet ? 'Change' : 'Set'}
            </button>
          </div>

          {notify && (
            <div className="assets-section">
              <div className="section-label">Monthly reminder</div>
              <div className="toggle-row">
                <span className="toggle-label">
                  Day {notify.financeNotifyDay} of each month, {notify.financeNotifyHour.padStart(2, '0')}:{notify.financeNotifyMinute.padStart(2, '0')}
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
        <div className="section-label">Passkey</div>
        <p className="assets-locked-sub">Passkeys are managed in your kevinprk account (shared by all apps).</p>
        <a className="btn-ghost btn-sm" href={api.passkey.manageURL} target="_blank" rel="noreferrer">Manage passkeys</a>
      </div>

      <a className="assets-grafana-link" href="https://dashboard.kevinprk.com/d/finance-assets" target="_blank" rel="noreferrer">
        View details in Grafana →
      </a>
    </div>
  )
}
