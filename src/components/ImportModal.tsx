import { useState } from 'react'
import type { ExportData } from '../types'

interface ImportModalProps {
  onClose: () => void
  onImport: (data: ExportData, mode: 'merge' | 'replace') => Promise<void>
}

function countTemplates(data: ExportData): number {
  return Object.values(data.templates).reduce((sum, arr) => sum + arr.length, 0)
}

export function ImportModal({ onClose, onImport }: ImportModalProps) {
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [data, setData] = useState<ExportData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as ExportData
        if (!parsed.templates) throw new Error('Invalid format')
        setData(parsed)
        setError('')
      } catch {
        setError('Invalid file — expected a task export JSON')
        setData(null)
      }
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    if (!data) return
    setLoading(true)
    try {
      await onImport(data, mode)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Import tasks</span>
        </div>
        <div className="modal-body">
          <div className="field">
            <label className="field-label">File</label>
            <input
              type="file"
              accept=".json"
              onChange={handleFile}
              style={{ fontSize: 'var(--kp-text-xs)', color: 'var(--kp-fg-2)' }}
            />
          </div>

          {data && (
            <div className="import-summary">
              Found {countTemplates(data)} templates across 6 slots.
            </div>
          )}

          {data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-2)' }}>
              <label
                className={`import-option${mode === 'merge' ? ' selected' : ''}`}
                onClick={() => setMode('merge')}
              >
                <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                <div className="import-option-text">
                  <strong>Merge</strong>
                  <span>Add new templates, keep existing ones</span>
                </div>
              </label>
              <label
                className={`import-option${mode === 'replace' ? ' selected' : ''}`}
                onClick={() => setMode('replace')}
              >
                <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                <div className="import-option-text">
                  <strong>Replace</strong>
                  <span>Overwrite all existing templates</span>
                </div>
              </label>
            </div>
          )}

          {error && <div className="modal-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-primary"
            disabled={!data || loading}
            onClick={handleImport}
          >
            {loading ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}
