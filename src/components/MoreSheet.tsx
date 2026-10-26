import { useEffect, useRef } from 'react'
import { Icon, type IconName } from './Icons'

export interface MoreItem { id: string; label: string; icon: IconName; sub: string }

// The bottom bar's "More" on a phone: the groups that do not fit the bar, as big rows in a sheet that rises above it.
// The bar itself stays visible and tappable (the backdrop stops above it).
export function MoreSheet({ items, activeId, onPick, onClose }: { items: MoreItem[]; activeId: string | undefined; onPick: (id: string) => void; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null)
  // The latest onClose without re-running the effect: App passes a new function on every render, and a re-run
  // would pull the focus back to the first row each time.
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      <div className="more-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="more-sheet" role="dialog" aria-modal="true" aria-label="More">
        {items.map((g, i) => (
          <button
            key={g.id}
            ref={i === 0 ? first : undefined}
            className={`more-row${g.id === activeId ? ' more-row-active' : ''}`}
            onClick={() => onPick(g.id)}
            aria-current={g.id === activeId ? 'page' : undefined}
          >
            <Icon name={g.icon} size={22} />
            <span className="more-row-text">
              <b>{g.label}</b>
              {g.sub && <i>{g.sub}</i>}
            </span>
            <Icon name="chevronRight" size={16} />
          </button>
        ))}
      </div>
    </>
  )
}
