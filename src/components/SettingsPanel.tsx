import type { Settings, ExportData } from '../types'

interface SettingsPanelProps {
  settings: Settings
  username: string | null
  onSave: (s: Partial<Settings>) => void
  onSignIn: () => void
  onSignOut: () => void
  onExport: () => void
  onImport: () => void
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  )
}

export function SettingsPanel({ settings, username, onSave, onSignIn, onSignOut, onExport, onImport }: SettingsPanelProps) {
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

        {/* Left column: Account + Schedule */}
        <div className="sp-col">
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
            </div>
          </div>

          <div className="sp-section">
            <div className="section-label">Schedule</div>
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
            </div>
          </div>
        </div>

        {/* Right column: Tasks + Tabs + Data */}
        <div className="sp-col">
          <div className="sp-section">
            <div className="section-label">Tasks</div>
            <div className="sp-rows">
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
            </div>
          </div>

          <div className="sp-section">
            <div className="section-label">Tabs</div>
            <div className="sp-rows">
              <div className="sp-row">
                <span className="sp-row-label">Show Agent tab</span>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.showAgent !== false}
                    onChange={e => onSave({ showAgent: e.target.checked })}
                  />
                  <span className="toggle-track" />
                </label>
              </div>
            </div>
          </div>

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
