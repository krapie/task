import { Icon } from './Icons'

// The toggle of useTranslation (lib/translate.ts): pressed = showing the Korean version.
export function TranslateButton({ on, busy, error, onToggle }: { on: boolean; busy: boolean; error: string; onToggle: () => void }) {
  const label = on ? 'Show original' : 'Translate to Korean'
  return (
    <span className="tx-wrap">
      <button type="button" className={`icon-btn tx-btn${on ? ' icon-btn-active' : ''}`} aria-pressed={on} aria-label={label} title={label} onClick={onToggle}>
        <Icon name="language" size={16} />
      </button>
      {on && <span className="as-meta tx-status" role="status" title="Translated by AI. Code, ids and numbers are left as written.">{error ? `Failed: ${error}` : busy ? 'Translating…' : 'AI · KO'}</span>}
    </span>
  )
}
