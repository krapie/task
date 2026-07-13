import type { Settings, ExportData } from '../types'

interface SettingsPanelProps {
  settings: Settings
  username: string | null
  onClose: () => void
  onSave: (s: Partial<Settings>) => void
  onSignIn: () => void
  onSignOut: () => void
  onExport: () => void
  onImport: () => void
}

export function SettingsPanel({ settings, username, onClose, onSave, onSignIn, onSignOut, onExport, onImport }: SettingsPanelProps) {
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
    <>
      <div className="panel-overlay" onClick={onClose} />
      <aside className="panel">
        <div className="panel-header">
          <span className="panel-title">Settings</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="panel-body">
          <div className="settings-group settings-account">
            <div className="settings-label">Account</div>
            {username ? (
              <div className="settings-account-row">
                <span className="settings-account-user">{username}</span>
                <button className="settings-action-btn settings-signout-btn" onClick={() => { onSignOut(); onClose() }}>
                  Sign out
                </button>
              </div>
            ) : (
              <button className="settings-action-btn" onClick={() => { onSignIn(); onClose() }}>
                Sign in
              </button>
            )}
          </div>

          <div className="settings-divider" />

          <div className="settings-group">
            <div className="settings-label">Daily reset time</div>
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
            <div className="settings-hint">{tz}</div>
          </div>

          <div className="settings-divider" />

          <div className="settings-group">
            <div className="settings-label">Work week</div>
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

          <div className="settings-divider" />

          <div className="settings-group">
            <div className="settings-label">Bonus tasks</div>
            <div className="toggle-row">
              <span className="toggle-label">Keep after reset</span>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.keepBonus}
                  onChange={e => onSave({ keepBonus: e.target.checked })}
                />
                <span className="toggle-track" />
              </label>
            </div>
          </div>

          <div className="settings-divider" />

          <div className="settings-group">
            <div className="settings-label">Data</div>
            <button className="settings-action-btn" onClick={onExport}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Export templates
            </button>
            <button className="settings-action-btn" onClick={onImport}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
              Import templates
            </button>
          </div>
        </div>
      </aside>
    </>
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
