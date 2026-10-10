import { useState, useEffect, useCallback } from 'react'
import type { Settings, ExportData, PushDevice } from '../types'
import { api } from '../lib/api'
import { confirmDialog } from '../lib/notify'

interface SettingsPanelProps {
  settings: Settings
  username: string | null
  theme: string
  onToggleTheme: () => void
  onSave: (s: Partial<Settings>) => void
  onSignIn: () => void
  onSignOut: () => void
  onExport: () => void
  onImport: () => void
}

function XMarkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  )
}

// "Chrome on macOS", "Safari on iPhone", … from a user agent. Rows saved
// before user agents were recorded fall back to the push service's host.
function deviceLabel(d: PushDevice): string {
  const ua = d.user_agent
  if (!ua) {
    if (d.endpoint.includes('push.apple.com')) return 'Apple device'
    if (d.endpoint.includes('fcm.googleapis.com')) return 'Chrome device'
    if (d.endpoint.includes('mozilla.com')) return 'Firefox device'
    return 'Unknown device'
  }
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  return `${browser} on ${os}`
}

function NotificationsSection({ isAuth }: { isAuth: boolean }) {
  const [supported, setSupported] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [devices, setDevices] = useState<PushDevice[] | null>(null)

  const loadDevices = useCallback(() => {
    if (!isAuth) { setDevices(null); return }
    api.push.list().then(setDevices, () => setDevices(null))
  }, [isAuth])
  useEffect(loadDevices, [loadDevices])

  useEffect(() => {
    setSupported('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window)
    if ('Notification' in window) setPermission(Notification.permission)

    async function checkSubscription() {
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        setSubscribed(!!sub)
        setEndpoint(sub?.endpoint ?? null)
      } catch {}
    }
    if ('serviceWorker' in navigator) checkSubscription()
  }, [])

  async function handleToggle() {
    if (!isAuth) { setHint('Sign in first to enable notifications'); return }
    setLoading(true)
    setHint(null)
    try {
      const reg = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()

      if (existing) {
        await api.push.unsubscribe(existing.endpoint)
        await existing.unsubscribe()
        setSubscribed(false)
        setEndpoint(null)
        setHint('Notifications disabled')
      } else {
        const { key } = await api.push.getVapidKey()
        const perm = await Notification.requestPermission()
        setPermission(perm)
        if (perm !== 'granted') { setHint('Permission denied'); return }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        })
        await api.push.subscribe(sub.toJSON() as PushSubscriptionJSON)
        setSubscribed(true)
        setEndpoint(sub.endpoint)
        setHint('Notifications enabled')
      }
    } catch (e) {
      setHint(`Error: ${(e as Error).message}`)
    } finally {
      setLoading(false)
      loadDevices()
    }
  }

  async function sendTest() {
    setHint(null)
    try {
      const { sent } = await api.push.test()
      setHint(`Test sent to ${sent} device${sent === 1 ? '' : 's'}`)
    } catch (e) {
      setHint(`Error: ${(e as Error).message}`)
    } finally {
      loadDevices()
    }
  }

  async function removeDevice(d: PushDevice) {
    if (!(await confirmDialog({ title: 'Remove device', body: `Stop email notifications to ${deviceLabel(d)}?`, confirmLabel: 'Remove', danger: true }))) return
    try {
      if (d.endpoint === endpoint) {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        await api.push.unsubscribe(d.endpoint)
        await sub?.unsubscribe()
        setSubscribed(false)
        setEndpoint(null)
      } else {
        await api.push.unsubscribe(d.endpoint)
      }
    } catch (e) {
      setHint(`Error: ${(e as Error).message}`)
    } finally {
      loadDevices()
    }
  }

  if (!supported) return null

  const blocked = permission === 'denied'

  return (
    <div className="sp-section">
      <div className="section-label">Mail</div>
      <div className="sp-rows">
        <div className="sp-row">
          <div className="sp-row-left">
            <span className="sp-row-label">Email notifications</span>
            {blocked
              ? <span className="sp-row-hint sp-hint-warn">Blocked in browser settings</span>
              : hint && <span className="sp-row-hint">{hint}</span>
            }
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={subscribed}
              disabled={loading || blocked}
              onChange={handleToggle}
            />
            <span className="toggle-track" />
          </label>
        </div>
        {devices && devices.length > 0 && (
          <div className="sp-row">
            <div className="sp-row-left">
              <span className="sp-row-label">Test notification</span>
              <span className="sp-row-hint">Sends to every device below</span>
            </div>
            <button className="sp-inline-btn" onClick={sendTest}>Send test</button>
          </div>
        )}
        {devices && devices.length > 0 && (
          <div className="sp-devices">
            {devices.map(d => (
              <div key={d.endpoint} className="sp-device" title={`Since ${new Date(d.created_at).toLocaleDateString()}`}>
                <span className="sp-device-label">
                  {deviceLabel(d)}
                  {d.endpoint === endpoint && <span className="sp-row-hint"> (this one)</span>}
                </span>
                <button className="sp-device-x" onClick={() => removeDevice(d)} aria-label={`Remove ${deviceLabel(d)}`} title="Remove">
                  <XMarkIcon />
                </button>
              </div>
            ))}
          </div>
        )}
        {subscribed && (
          <div className="sp-row sp-row-info">
            <span className="sp-row-hint">Push via device browser · iOS requires home screen install</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function SettingsPanel({ settings, username, theme, onToggleTheme, onSave, onSignIn, onSignOut, onExport, onImport }: SettingsPanelProps) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

  function handleHourChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Math.min(23, Math.max(0, parseInt(e.target.value) || 0))
    onSave({ rotateHour: v })
  }

  function handleMinuteChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Math.min(59, Math.max(0, parseInt(e.target.value) || 0))
    onSave({ rotateMinute: v })
  }

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <span className="settings-page-title">Settings</span>
      </div>

      <div className="settings-page-body">

        {/* Left column: Account + Routine */}
        <div className="sp-col">

          {/* Account — global, not tab-specific */}
          <div className="sp-section">
            <div className="section-label">Account</div>
            <div className="sp-rows">
              <div className="sp-row">
                <div className="sp-row-left">
                  <span className="sp-row-label">{username ?? 'Not signed in'}</span>
                  {username && <span className="sp-row-hint">Syncing to cloud</span>}
                </div>
                {username ? (
                  <button className="sp-inline-btn sp-btn-muted" onClick={onSignOut}>Sign out</button>
                ) : (
                  <button className="sp-inline-btn" onClick={onSignIn}>Sign in</button>
                )}
              </div>
              <div className="sp-row">
                <span className="sp-row-label">Dark mode</span>
                <label className="toggle">
                  <input type="checkbox" checked={theme === 'dark'} onChange={onToggleTheme} />
                  <span className="toggle-track" />
                </label>
              </div>
            </div>
          </div>

          {/* Routine — all settings for the Routine tab */}
          <div className="sp-section">
            <div className="section-label">Routine</div>
            <div className="sp-rows">
              <div className="sp-row">
                <div className="sp-row-left">
                  <span className="sp-row-label">Daily reset</span>
                  <span className="sp-row-hint">{tz}</span>
                </div>
                <div className="time-input-row">
                  <input
                    className="time-input"
                    type="number"
                    min={0}
                    max={23}
                    value={settings.rotateHour}
                    onChange={handleHourChange}
                  />
                  <span className="time-sep">:</span>
                  <input
                    className="time-input"
                    type="number"
                    min={0}
                    max={59}
                    value={String(settings.rotateMinute).padStart(2, '0')}
                    onChange={handleMinuteChange}
                  />
                </div>
              </div>
              <div className="sp-row sp-row-wrap">
                <span className="sp-row-label">Work week</span>
                <div className="work-week-options">
                  {(['mon-fri', 'tue-sat', 'sun-thu'] as const).map(opt => (
                    <button
                      key={opt}
                      className={`work-week-btn${settings.workWeek === opt ? ' work-week-active' : ''}`}
                      onClick={() => onSave({ workWeek: opt })}
                    >
                      {opt === 'mon-fri' ? 'Mon – Fri' : opt === 'tue-sat' ? 'Tue – Sat' : 'Sun – Thu'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sp-row">
                <span className="sp-row-label">Keep bonus tasks after reset</span>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.keepBonus}
                    onChange={e => onSave({ keepBonus: e.target.checked })}
                  />
                  <span className="toggle-track" />
                </label>
              </div>
              <div className="sp-row">
                <div className="sp-row-left">
                  <span className="sp-row-label">Daily task digest</span>
                  <span className="sp-row-hint">Push incomplete tasks each morning</span>
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.taskNotifyEnabled ?? false}
                    onChange={e => onSave({ taskNotifyEnabled: e.target.checked })}
                  />
                  <span className="toggle-track" />
                </label>
              </div>
              {(settings.taskNotifyEnabled ?? false) && (
                <div className="sp-row">
                  <div className="sp-row-left">
                    <span className="sp-row-label">Notify at</span>
                    <span className="sp-row-hint">{tz}</span>
                  </div>
                  <div className="time-input-row">
                    <input
                      className="time-input"
                      type="number"
                      min={0}
                      max={23}
                      value={settings.taskNotifyHour ?? 9}
                      onChange={e => onSave({ taskNotifyHour: Math.min(23, Math.max(0, parseInt(e.target.value) || 0)) })}
                    />
                    <span className="time-sep">:</span>
                    <input
                      className="time-input"
                      type="number"
                      min={0}
                      max={59}
                      value={String(settings.taskNotifyMinute ?? 0).padStart(2, '0')}
                      onChange={e => onSave({ taskNotifyMinute: Math.min(59, Math.max(0, parseInt(e.target.value) || 0)) })}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column: Mail + Data */}
        <div className="sp-col">

          {/* Mail — settings for the Mail tab */}
          <NotificationsSection isAuth={!!username} />

          {/* Data — template management */}
          <div className="sp-section">
            <div className="section-label">Data</div>
            <div className="sp-rows">
              <button className="sp-row sp-row-action" onClick={onExport}>
                <span className="sp-row-label">Export templates</span>
                <ChevronRightIcon />
              </button>
              <button className="sp-row sp-row-action" onClick={onImport}>
                <span className="sp-row-label">Import templates</span>
                <ChevronRightIcon />
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

export function downloadExport(data: ExportData) {
  const date = new Date().toISOString().split('T')[0]
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `task-export-${date}.json`
  a.click()
  URL.revokeObjectURL(url)
}
