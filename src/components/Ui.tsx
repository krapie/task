// Shared building blocks: Dialog, Loading, Empty, plus hosts for toasts, confirm/prompt
// dialogs and the top progress bar (all mounted once in App).
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Icon, type IconName } from './Icons'
import { dialogStore, toastStore } from '../lib/notify'
import { inflightStore } from '../lib/inflight'

export function Dialog({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  // Callers pass inline closures; keep the latest in a ref so the effect (and focus) runs once.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [])
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1} ref={ref} onClick={e => e.stopPropagation()}>
        <div className="modal-header"><span className="modal-title">{title}</span></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

// Renders the queue from confirmDialog()/promptDialog(); only the oldest request shows.
export function DialogHost() {
  const list = useSyncExternalStore(dialogStore.subscribe, dialogStore.get)
  const d = list[0]
  const [value, setValue] = useState('')
  useEffect(() => { setValue('') }, [d?.id])
  if (!d) return null
  const cancel = () => dialogStore.close(d.id, d.kind === 'confirm' ? false : null)
  const ok = () => dialogStore.close(d.id, d.kind === 'confirm' ? true : value)
  return (
    <Dialog
      key={d.id}
      title={d.title}
      onClose={cancel}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={cancel}>Cancel</button>
          <button type="button" className={`btn-primary${d.danger ? ' btn-danger' : ''}`} onClick={ok} disabled={d.kind === 'prompt' && !value}>{d.confirmLabel ?? 'OK'}</button>
        </>
      }
    >
      {d.body && <p className="modal-lead">{d.body}</p>}
      {d.kind === 'prompt' && (
        <input
          className="field-input"
          type={d.password ? 'password' : 'text'}
          placeholder={d.placeholder}
          value={value}
          autoFocus
          autoComplete="off"
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && value) ok() }}
        />
      )}
    </Dialog>
  )
}

export function ToastHost() {
  const list = useSyncExternalStore(toastStore.subscribe, toastStore.get)
  if (list.length === 0) return null
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {list.map(t => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span>{t.text}</span>
          {t.action && (
            <button className="btn-ghost btn-sm toast-action" onClick={() => { t.action!.run(); toastStore.dismiss(t.id) }}>{t.action.label}</button>
          )}
          <button className="icon-btn" onClick={() => toastStore.dismiss(t.id)} aria-label="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

// Shows only after 150ms so fast responses don't flicker.
export function LoadingBar() {
  const n = useSyncExternalStore(inflightStore.subscribe, inflightStore.get)
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!n) { setShow(false); return }
    const t = setTimeout(() => setShow(true), 150)
    return () => clearTimeout(t)
  }, [n])
  return show ? <div className="top-progress" role="progressbar" aria-label="Loading" /> : null
}

// Placeholder lines while a list loads; keeps the layout from jumping.
export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton-line" style={{ width: `${90 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  )
}

// Empty state: icon, a title, one line of guidance and an optional call to action.
export function Empty({ icon, title, hint, action, compact, children }: {
  icon?: IconName
  title?: ReactNode
  hint?: ReactNode
  action?: { label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; disabled?: boolean }
  compact?: boolean
  children?: ReactNode
}) {
  return (
    <div className={`empty-state empty-rich${compact ? ' empty-compact' : ''}`}>
      {icon && <Icon name={icon} size={compact ? 20 : 24} className="empty-icon" />}
      {title && <div className="empty-title">{title}</div>}
      {(hint || children) && <div className="empty-hint">{hint ?? children}</div>}
      {action && <button type="button" className="btn-ghost btn-sm empty-action" onClick={action.onClick} disabled={action.disabled}>{action.label}</button>}
    </div>
  )
}

// Thin neutral progress bar (goal progress, share of total). `value` is clamped to 0..max.
export function Meter({ value, max, label }: { value: number | null | undefined; max: number | null | undefined; label?: string }) {
  const pct = value != null && max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max ?? 0} aria-valuenow={value ?? 0}>
      <div className="meter-fill" style={{ width: `${pct}%` }} />
    </div>
  )
}
