import { useEffect, useRef, useState } from 'react'

export const SPLIT_HANDLE_W = 17
export const SPLIT_MIN_LIST = 360   // narrowest the list column may get
export const SPLIT_MIN_OTHER = 280  // narrowest the panel on the other side may get

// Vertical drag handle between two panels in a flex row. It controls the width of the panel on its left;
// the one on the right takes whatever is left. Pointer drag, arrow keys (Shift = bigger steps), double-click or Home to reset.
export function SplitHandle({ value, onChange, onReset }: {
  value: number
  onChange: (width: number, commit?: boolean) => void
  onReset: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; w: number; last: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const maxWidth = () => {
    const parent = ref.current?.parentElement
    if (!parent) return 1000
    const cs = getComputedStyle(parent)
    return parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - SPLIT_HANDLE_W - SPLIT_MIN_OTHER
  }
  const clamp = (w: number) => Math.round(Math.max(SPLIT_MIN_LIST, Math.min(maxWidth(), w)))

  // No text selection or cursor flicker while dragging.
  useEffect(() => {
    document.body.classList.toggle('is-resizing', dragging)
    return () => document.body.classList.remove('is-resizing')
  }, [dragging])

  return (
    <div
      ref={ref}
      className={`split-handle${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panels"
      aria-valuenow={value}
      aria-valuemin={SPLIT_MIN_LIST}
      tabIndex={0}
      onPointerDown={e => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, w: value, last: value }
        setDragging(true)
      }}
      onPointerMove={e => {
        const d = drag.current
        if (!d) return
        d.last = clamp(d.w + e.clientX - d.x)
        onChange(d.last)
      }}
      onPointerUp={e => {
        const d = drag.current
        if (!d) return
        e.currentTarget.releasePointerCapture(e.pointerId)
        drag.current = null
        setDragging(false)
        onChange(d.last, true)
      }}
      onPointerCancel={() => { drag.current = null; setDragging(false) }}
      onDoubleClick={onReset}
      onKeyDown={e => {
        const step = e.shiftKey ? 96 : 24
        if (e.key === 'ArrowLeft') { e.preventDefault(); onChange(clamp(value - step), true) }
        else if (e.key === 'ArrowRight') { e.preventDefault(); onChange(clamp(value + step), true) }
        else if (e.key === 'Home') { e.preventDefault(); onReset() }
      }}
    />
  )
}
